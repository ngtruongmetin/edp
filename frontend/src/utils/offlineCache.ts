const DB_NAME = "edp-offline-cache"
const DB_VERSION = 1
const STORE_NAME = "app-cache"

export type CachedUser = {
  role: string
  class_id?: number
  username?: string
  class_name?: string
  displayName?: string
  lastVerifiedAt: string
}

export type DashboardUserIdentity = {
  role: string
  class_id?: number
  username?: string
  class_name?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const db = await openDb()

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)

    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)

    action(store, resolve, reject)
  })
}

export async function getCachedUser() {
  return withStore<CachedUser | null>("readonly", (store, resolve, reject) => {
    const request = store.get("currentUser")

    request.onsuccess = () => resolve((request.result as CachedUser | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function setCachedUser(user: CachedUser) {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(user, "currentUser")

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function clearCachedUser() {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete("currentUser")

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function getCachedDashboard<T>(key: string) {
  return withStore<T | null>("readonly", (store, resolve, reject) => {
    const request = store.get(`dashboard:${key}`)

    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function setCachedDashboard<T>(key: string, value: T) {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(value, `dashboard:${key}`)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function clearCachedDashboard(key: string) {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(`dashboard:${key}`)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export function buildDashboardCacheKey(user?: DashboardUserIdentity | null) {
  if (!user?.role) return "anonymous"

  if (user.role === "admin") {
    const identity = user.username || String(user.class_id ?? "") || user.class_name || "unknown"
    return `${user.role}:${identity}`
  }

  const identity = user.class_id != null
    ? String(user.class_id)
    : user.class_name || user.username || "unknown"

  return `${user.role}:${identity}`
}
