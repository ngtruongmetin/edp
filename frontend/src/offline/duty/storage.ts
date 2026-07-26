import type {
  DutyOfflineAttachment,
  DutyOfflineOperation,
  OfflineDutySession,
} from "./types"

const DB_NAME = "edp-duty-offline"
const DB_VERSION = 2
const SESSION_STORE = "sessions"
const OPERATION_STORE = "operations"
const ATTACHMENT_STORE = "attachments"
const METADATA_STORE = "metadata"
const LEGACY_PIN_GRANT_STORE = "pin-grants"
export const DUTY_STORAGE_CHANGED_EVENT = "edp-duty-storage-changed"

type StoreName =
  | typeof SESSION_STORE
  | typeof OPERATION_STORE
  | typeof ATTACHMENT_STORE
  | typeof METADATA_STORE

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function openDutyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const store = db.createObjectStore(SESSION_STORE, { keyPath: "clientId" })
        store.createIndex("ownerClass", "ownerClass")
        store.createIndex("localId", "localId", { unique: true })
        store.createIndex("serverId", "serverId", { unique: false })
      }
      if (!db.objectStoreNames.contains(OPERATION_STORE)) {
        const store = db.createObjectStore(OPERATION_STORE, { keyPath: "id" })
        store.createIndex("ownerClass", "ownerClass")
        store.createIndex("clientId", "clientId")
        store.createIndex("status", "status")
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const store = db.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" })
        store.createIndex("clientId", "clientId")
        store.createIndex("ownerClass", "ownerClass")
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE)
      if (db.objectStoreNames.contains(LEGACY_PIN_GRANT_STORE)) db.deleteObjectStore(LEGACY_PIN_GRANT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function accessStore<T>(storeName: StoreName, mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>) {
  const db = await openDutyDb()
  const tx = db.transaction(storeName, mode)
  const done = transactionDone(tx)
  try {
    const result = await work(tx.objectStore(storeName))
    await done
    return result
  } finally {
    db.close()
  }
}

function notifyChanged() {
  window.dispatchEvent(new CustomEvent(DUTY_STORAGE_CHANGED_EVENT))
}

export class OfflineStorage {
  async getSession(clientId: string) {
    return accessStore(SESSION_STORE, "readonly", async (store) =>
      (await requestResult(store.get(clientId))) as OfflineDutySession | undefined,
    )
  }

  async findSessionByRouteId(ownerClass: string, routeId: number) {
    const sessions = await this.listSessions(ownerClass)
    return sessions.find((item) => item.localId === routeId || item.serverId === routeId) ?? null
  }

  async listSessions(ownerClass: string) {
    return accessStore(SESSION_STORE, "readonly", async (store) => {
      const all = (await requestResult(store.getAll())) as OfflineDutySession[]
      return all.filter((item) => item.ownerClass === ownerClass).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })
  }

  async putSession(session: OfflineDutySession) {
    await accessStore(SESSION_STORE, "readwrite", async (store) => {
      await requestResult(store.put(session))
    })
    notifyChanged()
  }

  async deleteSession(clientId: string) {
    await accessStore(SESSION_STORE, "readwrite", async (store) => {
      await requestResult(store.delete(clientId))
    })
    notifyChanged()
  }

  async getOperation(id: string) {
    return accessStore(OPERATION_STORE, "readonly", async (store) =>
      (await requestResult(store.get(id))) as DutyOfflineOperation | undefined,
    )
  }

  async listOperations(ownerClass: string, includeCompleted = false) {
    return accessStore(OPERATION_STORE, "readonly", async (store) => {
      const all = (await requestResult(store.getAll())) as DutyOfflineOperation[]
      return all
        .filter((item) => item.ownerClass === ownerClass && (includeCompleted || !["completed", "cancelled"].includes(item.status)))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    })
  }

  async putOperation(operation: DutyOfflineOperation) {
    await accessStore(OPERATION_STORE, "readwrite", async (store) => {
      await requestResult(store.put(operation))
    })
    notifyChanged()
  }

  async putAttachment(attachment: DutyOfflineAttachment) {
    await accessStore(ATTACHMENT_STORE, "readwrite", async (store) => {
      await requestResult(store.put(attachment))
    })
    notifyChanged()
  }

  async getAttachment(id: string) {
    return accessStore(ATTACHMENT_STORE, "readonly", async (store) =>
      (await requestResult(store.get(id))) as DutyOfflineAttachment | undefined,
    )
  }

  async listAttachments(clientId: string) {
    return accessStore(ATTACHMENT_STORE, "readonly", async (store) => {
      const all = (await requestResult(store.getAll())) as DutyOfflineAttachment[]
      return all.filter((item) => item.clientId === clientId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    })
  }

  async deleteAttachment(id: string) {
    await accessStore(ATTACHMENT_STORE, "readwrite", async (store) => {
      await requestResult(store.delete(id))
    })
    notifyChanged()
  }

  async deleteAttachmentsForSession(clientId: string) {
    await accessStore(ATTACHMENT_STORE, "readwrite", async (store) => {
      const keys = await requestResult(store.index("clientId").getAllKeys(clientId))
      for (const key of keys) await requestResult(store.delete(key))
    })
    notifyChanged()
  }

  async getMetadata<T>(key: string) {
    return accessStore(METADATA_STORE, "readonly", async (store) =>
      ((await requestResult(store.get(key))) as T | undefined) ?? null,
    )
  }

  async setMetadata<T>(key: string, value: T) {
    await accessStore(METADATA_STORE, "readwrite", async (store) => {
      await requestResult(store.put(value, key))
    })
    notifyChanged()
  }

  async setMetadataEntries(entries: Array<{ key: string; value: unknown }>) {
    await accessStore(METADATA_STORE, "readwrite", async (store) => {
      for (const entry of entries) {
        await requestResult(store.put(entry.value, entry.key))
      }
    })
    notifyChanged()
  }

}

export const dutyStorage = new OfflineStorage()
