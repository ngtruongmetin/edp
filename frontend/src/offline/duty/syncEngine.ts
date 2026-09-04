import axios from "axios"
import { api } from "../../api/api"
import { DUTY_STORAGE_CHANGED_EVENT, dutyStorage } from "./storage"
import type { DutyOfflineOperation, DutySyncStatus, OfflineDutySession } from "./types"
import { NetworkMonitor } from "./networkMonitor"

type StatusListener = (status: DutySyncStatus) => void

type CompletedOperationStatus = {
  operation_id: string
  operation_type: string
  response: Record<string, unknown>
}

type OperationStatusResponse = {
  completed: CompletedOperationStatus[]
  deleted_session_client_ids: string[]
}

const BASE_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000

export class DutySyncEngine {
  readonly ownerClass: string
  private running = false
  private enabled: boolean
  private stopped = false
  private retryTimer: number | null = null
  private listeners = new Set<StatusListener>()
  private networkMonitor: NetworkMonitor
  private unsubscribeNetwork: () => void
  private status: DutySyncStatus = {
    isOnline: navigator.onLine,
    phase: navigator.onLine ? "idle" : "offline",
    pending: 0,
    pendingOperations: 0,
    completed: 0,
    total: 0,
  }

  readonly handleStorageChanged = () => {
    void this.refreshStatus()
    if (navigator.onLine) void this.sync()
  }

  readonly handleOnline = () => {
    this.setStatus({ isOnline: true, phase: "idle", lastError: undefined })
    void this.sync()
  }

  readonly handleOffline = () => {
    this.clearRetryTimer()
    this.setStatus({ isOnline: false, phase: "offline" })
  }

  constructor(ownerClass: string, enabled = false) {
    this.ownerClass = ownerClass
    this.enabled = enabled
    window.addEventListener(DUTY_STORAGE_CHANGED_EVENT, this.handleStorageChanged)
    this.networkMonitor = new NetworkMonitor()
    this.unsubscribeNetwork = this.networkMonitor.subscribe((online) => {
      if (online) this.handleOnline()
      else this.handleOffline()
    })
    void this.refreshStatus()
  }

  subscribe(listener: StatusListener) {
    this.listeners.add(listener)
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy() {
    this.stopped = true
    this.clearRetryTimer()
    window.removeEventListener(DUTY_STORAGE_CHANGED_EVENT, this.handleStorageChanged)
    this.unsubscribeNetwork()
    this.networkMonitor.destroy()
    this.listeners.clear()
  }

  async sync() {
    if (!this.enabled || this.running || this.stopped || !navigator.onLine) return
    this.running = true
    this.clearRetryTimer()

    try {
      let operations = await dutyStorage.listOperations(this.ownerClass)
      operations = await this.reconcileCompletedOperations(operations)
      if (!operations.length) {
        this.setStatus({ isOnline: true, phase: "synced", pending: 0, pendingOperations: 0, total: 0, completed: 0, lastError: undefined })
        return
      }

      const total = new Set(operations.map((item) => item.clientId)).size
      this.setStatus({ isOnline: true, phase: "syncing", pending: total, pendingOperations: operations.length, total, completed: 0, lastError: undefined })

      while (!this.stopped && navigator.onLine) {
        operations = await dutyStorage.listOperations(this.ownerClass)
        const syncable = operations.filter((item) => item.status === "pending" || item.status === "syncing")
        const next = syncable.find((item) => item.nextAttemptAt <= Date.now())
        if (!next) {
          if (syncable.length) {
            const nextAttemptAt = Math.min(...syncable.map((item) => item.nextAttemptAt))
            this.scheduleRetry(Math.max(250, nextAttemptAt - Date.now()))
          }
          break
        }

        try {
          await dutyStorage.putOperation({ ...next, status: "syncing", lastError: undefined })
          await this.execute(next)
          await dutyStorage.putOperation({ ...next, status: "completed", completedAt: new Date().toISOString(), lastError: undefined })
          const remainingOperations = await dutyStorage.listOperations(this.ownerClass)
          const remaining = new Set(remainingOperations.map((item) => item.clientId)).size
          this.setStatus({ isOnline: true, phase: remaining ? "syncing" : "synced", pending: remaining, pendingOperations: remainingOperations.length, total, completed: total - remaining })
          if (!remainingOperations.length) break
        } catch (error) {
          const retryCount = next.retryCount + 1
          const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(retryCount - 1, 8))
          const message = error instanceof Error ? error.message : "Không thể đồng bộ."
          const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined
          const permanent = responseStatus != null && responseStatus >= 400 && responseStatus < 500 && responseStatus !== 408 && responseStatus !== 429
          await dutyStorage.putOperation({
            ...next,
            status: permanent ? "failed" : "pending",
            retryCount,
            nextAttemptAt: permanent ? Number.MAX_SAFE_INTEGER : Date.now() + delay,
            lastError: message,
          })
          this.setStatus({ isOnline: navigator.onLine, phase: "error", lastError: message })
          if (!permanent) this.scheduleRetry(delay)
          break
        }
      }
    } finally {
      this.running = false
      await this.refreshStatus()
    }
  }

  private async execute(operation: DutyOfflineOperation) {
    const session = await dutyStorage.getSession(operation.clientId)
    if (!session) throw new Error("Phiếu trực cục bộ không còn tồn tại.")

    switch (operation.kind) {
      case "create_session":
        await this.createSession(session, operation)
        return
      case "add_violation":
        await this.addViolation(session, operation)
        return
      case "update_violation":
        await api.post(`/duty/offline/sessions/${session.clientId}/violations/update`, { operation_id: operation.id, ...operation.payload })
        return
      case "delete_violation":
        await api.post(`/duty/offline/sessions/${session.clientId}/violations/delete`, { operation_id: operation.id, ...operation.payload })
        return
      case "upload_evidence":
        await this.uploadEvidence(session, operation)
        return
      case "delete_evidence":
        await api.post(`/duty/offline/sessions/${session.clientId}/evidences/delete`, { operation_id: operation.id, ...operation.payload })
        return
      case "sign":
        await this.sign(session, operation)
        return
    }
  }

  private async reconcileCompletedOperations(operations: DutyOfflineOperation[]) {
    const reconcilable = operations.filter((item) => item.kind !== "create_session")
    const clientIds = [...new Set(operations.map((item) => item.clientId))]
    const sessions = await Promise.all(clientIds.map((clientId) => dutyStorage.getSession(clientId)))
    const knownSessionClientIds = sessions
      .filter((session) => Boolean(session?.serverId))
      .map((session) => session!.clientId)
    if (!reconcilable.length && !knownSessionClientIds.length) return operations

    try {
      const response = await api.post<OperationStatusResponse>("/duty/offline/operations/status", {
        operation_ids: reconcilable.map((item) => item.id),
        known_session_client_ids: knownSessionClientIds,
      })
      const completedIds = new Set(response.data.completed.map((item) => item.operation_id))
      const deletedClientIds = new Set(response.data.deleted_session_client_ids || [])
      if (!completedIds.size && !deletedClientIds.size) return operations

      for (const operation of operations) {
        const completed = completedIds.has(operation.id)
        const deleted = deletedClientIds.has(operation.clientId)
        if (!completed && !deleted) continue
        await dutyStorage.putOperation({
          ...operation,
          status: completed ? "completed" : "cancelled",
          completedAt: completed ? operation.completedAt || new Date().toISOString() : operation.completedAt,
          lastError: undefined,
        })
      }
      for (const clientId of deletedClientIds) {
        await dutyStorage.deleteAttachmentsForSession(clientId)
        await dutyStorage.deleteSession(clientId)
      }
      return operations.filter((item) => !completedIds.has(item.id) && !deletedClientIds.has(item.clientId))
    } catch (error) {
      console.warn("Khong the doi soat hang doi dong bo voi may chu.", error)
      return operations
    }
  }

  private async createSession(session: OfflineDutySession, operation: DutyOfflineOperation) {
    const response = await api.post("/duty/offline/sessions", operation.payload)
    await dutyStorage.putSession({
      ...session,
      serverId: Number(response.data.session_id),
      status: response.data.session?.status || session.status,
      updatedAt: new Date().toISOString(),
    })
  }

  private async addViolation(session: OfflineDutySession, operation: DutyOfflineOperation) {
    const response = await api.post(`/duty/offline/sessions/${session.clientId}/violations`, { operation_id: operation.id, ...operation.payload })
    const violationClientId = String(operation.payload.violation_client_id || "")
    const current = await dutyStorage.getSession(session.clientId)
    if (!current) return
    await dutyStorage.putSession({
      ...current,
      violations: current.violations.map((item) => item.clientId === violationClientId ? { ...item, id: Number(response.data.id), serverId: Number(response.data.id) } : item),
      updatedAt: new Date().toISOString(),
    })
  }

  private async uploadEvidence(session: OfflineDutySession, operation: DutyOfflineOperation) {
    const attachment = await dutyStorage.getAttachment(operation.attachmentIds[0])
    if (!attachment) throw new Error("Ảnh minh chứng cục bộ không còn tồn tại.")
    const form = new FormData()
    form.append("operation_id", operation.id)
    form.append("file", attachment.blob, attachment.fileName)
    const response = await api.post(`/duty/offline/sessions/${session.clientId}/evidences`, form)
    await dutyStorage.putAttachment({
      ...attachment,
      serverId: Number(response.data.id),
      serverUrl: String(response.data.url || ""),
    })
  }

  private async sign(session: OfflineDutySession, operation: DutyOfflineOperation) {
    const form = new FormData()
    form.append("operation_id", operation.id)
    if (operation.attachmentIds[0]) {
      const attachment = await dutyStorage.getAttachment(operation.attachmentIds[0])
      if (!attachment) throw new Error("Ảnh chữ ký cục bộ không còn tồn tại.")
      form.append("photo", attachment.blob, attachment.fileName)
    }
    const response = await api.post(`/duty/offline/sessions/${session.clientId}/sign`, form)
    const current = await dutyStorage.getSession(session.clientId)
    if (!current) return
    await dutyStorage.putSession({
      ...current,
      status: "signed",
      signedAt: String(response.data.signed_at || current.signedAt || new Date().toISOString()),
      signatureSignedAt: String(response.data.signed_at || current.signatureSignedAt || new Date().toISOString()),
      signaturePhotoPath: String(response.data.photo_path || current.signaturePhotoPath || "") || null,
      updatedAt: new Date().toISOString(),
    })
  }

  private async refreshStatus() {
    const active = await dutyStorage.listOperations(this.ownerClass)
    const syncing = active.filter((item) => item.status === "syncing").length
    const failed = active.filter((item) => item.status === "failed").length
    const pendingSessions = new Set(active.map((item) => item.clientId)).size
    const phase = !navigator.onLine ? "offline" : syncing ? "syncing" : failed ? "error" : active.length ? this.status.phase : "synced"
    this.setStatus({
      isOnline: navigator.onLine,
      phase,
      pending: pendingSessions,
      pendingOperations: active.length,
      total: Math.max(this.status.total, pendingSessions),
      completed: pendingSessions ? Math.max(0, this.status.total - pendingSessions) : this.status.total,
      lastError: failed ? active.find((item) => item.lastError)?.lastError : this.status.lastError,
    })
  }

  private scheduleRetry(delay: number) {
    this.clearRetryTimer()
    this.retryTimer = window.setTimeout(() => void this.sync(), delay)
  }

  private clearRetryTimer() {
    if (this.retryTimer != null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private setStatus(patch: Partial<DutySyncStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((listener) => listener(this.status))
  }
}
