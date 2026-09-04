import { api } from "../../api/api"
import { localISODate } from "../../utils/dateLocal"
import { dutyStorage } from "./storage"
import type {
  DutyOfflineAttachment,
  DutyOfflineDataSnapshot,
  DutyOfflineManifest,
  DutyOfflineOperation,
  DutyOfflineReadiness,
  DutyRuleSnapshot,
  DutyWeekSnapshot,
  OfflineDutySession,
  OfflineDutyViolation,
} from "./types"

type DutyBootstrap = {
  ownerClass: string
  dutyClass: string
  week: DutyWeekSnapshot
}

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/

type ServerSession = {
  id: number
  client_id?: string | null
  date: string
  red_class: string
  duty_class: string
  status: "draft" | "signed"
  created_at?: string
  signed_at?: string | null
  signature_signed_at?: string | null
  signature_photo_path?: string | null
  bonus_points?: number
}

const repositories = new Map<string, OfflineDutyRepository>()
const OFFLINE_ENABLED_KEY = "offline-duty-enabled"

function nowIso() {
  return new Date().toISOString()
}

function localNumericId() {
  return -Math.floor(Date.now() * 1000 + Math.random() * 999)
}

function operation(ownerClass: string, clientId: string, kind: DutyOfflineOperation["kind"], payload: Record<string, unknown>, attachmentIds: string[] = []): DutyOfflineOperation {
  return {
    id: crypto.randomUUID(),
    clientId,
    ownerClass,
    kind,
    createdAt: nowIso(),
    payload,
    attachmentIds,
    status: "pending",
    retryCount: 0,
    nextAttemptAt: 0,
  }
}

export class OfflineDutyRepository {
  readonly ownerClass: string

  constructor(ownerClass: string) {
    this.ownerClass = ownerClass
  }

  async setOfflineEnabled(enabled: boolean) {
    await dutyStorage.setMetadata(OFFLINE_ENABLED_KEY, enabled, false)
  }

  async isOfflineEnabled() {
    return (await dutyStorage.getMetadata<boolean>(OFFLINE_ENABLED_KEY)) ?? false
  }

  async clearOfflinePreload() {
    const snapshot = await this.getOfflineData()
    const bootstrap = await this.getBootstrap()
    const keys = [this.offlineDataKey(), this.rulesKey(), this.bootstrapKey()]
    const dutyClass = snapshot?.assignments.find((item) => item.red_class === this.ownerClass)?.duty_class || bootstrap?.dutyClass
    if (dutyClass) keys.push(`pin-attempts:${this.ownerClass}:${dutyClass}`)
    for (const key of keys) await dutyStorage.deleteMetadata(key, false)
  }

  private bootstrapKey() {
    return `bootstrap:${this.ownerClass}`
  }

  private rulesKey() {
    return `rules:${this.ownerClass}`
  }

  private offlineDataKey() {
    return `offline-data:${this.ownerClass}`
  }

  private isValidOfflineData(value: DutyOfflineDataSnapshot | null): value is DutyOfflineDataSnapshot {
    if (!value || value.version !== 1 || value.owner_class !== this.ownerClass || !value.week?.id) return false
    const validUntil = value.valid_until || `${value.week.end_date}T23:59:59+07:00`
    const validUntilMs = Date.parse(validUntil)
    if (!Number.isFinite(validUntilMs) || Date.now() > validUntilMs) return false
    if (!Array.isArray(value.classes) || !value.classes.length || !Array.isArray(value.rules) || !value.rules.length) return false
    if (!Array.isArray(value.assignments) || !value.assignments.some((item) => item.red_class === this.ownerClass && item.duty_class)) return false
    if (!Array.isArray(value.committees) || value.committees.length !== value.classes.length) return false

    const committeeByClass = new Map(value.committees.map((item) => [item.class_id, item]))
    return value.classes.every((item) => {
      const committee = committeeByClass.get(item.id)
      return Boolean(committee?.account_id && committee.class_name === item.name && BCRYPT_HASH_PATTERN.test(committee.pin_hash))
    })
  }

  async syncOfflineData(force = false) {
    if (!(await this.isOfflineEnabled())) throw new Error("OFFLINE_DUTY_DISABLED")
    const cached = await this.getOfflineData()
    if (!force && this.isValidOfflineData(cached) && cached.data_version) {
      const manifestResponse = await api.get<DutyOfflineManifest>("/duty/offline/manifest")
      const manifest = manifestResponse.data
      if (
        manifest.version === cached.version &&
        manifest.owner_class === this.ownerClass &&
        manifest.week_id === cached.week.id &&
        manifest.data_version === cached.data_version
      ) {
        return cached
      }
    }

    const response = await api.get<DutyOfflineDataSnapshot>("/duty/offline/bootstrap")
    const snapshot = response.data
    if (!snapshot.data_version || !snapshot.valid_until || !this.isValidOfflineData(snapshot)) {
      throw new Error("OFFLINE_DATA_INCOMPLETE")
    }

    const assignment = snapshot.assignments.find((item) => item.red_class === this.ownerClass)
    if (!assignment) throw new Error("OFFLINE_DATA_INCOMPLETE")

    const bootstrap = {
      ownerClass: this.ownerClass,
      dutyClass: assignment.duty_class,
      week: snapshot.week,
    }
    await dutyStorage.setMetadataEntries([
      { key: this.offlineDataKey(), value: snapshot },
      { key: this.rulesKey(), value: snapshot.rules },
      { key: this.bootstrapKey(), value: bootstrap },
    ])
    return snapshot
  }

  async getOfflineData() {
    return dutyStorage.getMetadata<DutyOfflineDataSnapshot>(this.offlineDataKey())
  }

  async getOfflineReadiness(): Promise<DutyOfflineReadiness> {
    const snapshot = await this.getOfflineData()
    return this.isValidOfflineData(snapshot)
      ? { ready: true, syncing: false, syncedAt: snapshot.generated_at }
      : { ready: false, syncing: false }
  }

  async saveBootstrap(bootstrap: DutyBootstrap) {
    await dutyStorage.setMetadata(this.bootstrapKey(), bootstrap)
  }

  async getBootstrap() {
    return dutyStorage.getMetadata<DutyBootstrap>(this.bootstrapKey())
  }

  async loadRules() {
    if (!(await this.isOfflineEnabled())) {
      if (!navigator.onLine) return []
      const response = await api.get<DutyRuleSnapshot[]>("/rules")
      return response.data || []
    }
    const snapshot = await this.getOfflineData()
    if (this.isValidOfflineData(snapshot)) return snapshot.rules
    if (navigator.onLine) {
      try {
        return (await this.syncOfflineData()).rules
      } catch (error) {
        console.warn("Không thể tải danh sách lỗi, dùng dữ liệu đã lưu trên thiết bị.", error)
      }
    }
    return (await dutyStorage.getMetadata<DutyRuleSnapshot[]>(this.rulesKey())) ?? []
  }

  async createSession() {
    if (!(await this.isOfflineEnabled())) {
      if (!navigator.onLine) throw new Error("OFFLINE_DUTY_DISABLED")
      const response = await api.post("/duty/create")
      const session = await this.loadSessionById(Number(response.data.session_id))
      if (!session) throw new Error("DUTY_SESSION_MISSING")
      return session
    }
    if (navigator.onLine) {
      try {
        await this.syncOfflineData()
      } catch (error) {
        console.warn("Khong the lam moi du lieu ngoai tuyen truoc khi tao phien truc.", error)
      }
    }
    const snapshot = await this.getOfflineData()
    if (!this.isValidOfflineData(snapshot)) throw new Error("OFFLINE_DATA_NOT_READY")
    const assignment = snapshot.assignments.find((item) => item.red_class === this.ownerClass)
    if (!assignment) throw new Error("OFFLINE_DATA_NOT_READY")
    const bootstrap = { ownerClass: this.ownerClass, dutyClass: assignment.duty_class, week: snapshot.week }
    const clientId = crypto.randomUUID()
    const createdAt = nowIso()
    const session: OfflineDutySession = {
      clientId,
      ownerClass: this.ownerClass,
      localId: localNumericId(),
      date: localISODate(new Date()),
      redClass: this.ownerClass,
      dutyClass: bootstrap.dutyClass,
      week: bootstrap.week,
      status: "draft",
      createdAt,
      updatedAt: createdAt,
      signedAt: null,
      signatureSignedAt: null,
      signaturePhotoPath: null,
      bonusPoints: 0,
      violations: [],
    }
    await dutyStorage.putSessionAndOperation(session, operation(this.ownerClass, clientId, "create_session", {
      client_id: clientId,
      date: session.date,
      created_at: createdAt,
    }))
    return session
  }

  async findCurrentLocalSession() {
    const today = localISODate(new Date())
    const sessions = await dutyStorage.listSessions(this.ownerClass)
    return sessions.find((item) => item.date === today) ?? null
  }

  async getSessionByRouteId(routeId: number) {
    if (!(await this.isOfflineEnabled()) && !navigator.onLine) return null
    return dutyStorage.findSessionByRouteId(this.ownerClass, routeId)
  }

  async getSession(clientId: string) {
    const session = await dutyStorage.getSession(clientId)
    return session?.ownerClass === this.ownerClass ? session : null
  }

  async loadCurrentSession() {
    if (!(await this.isOfflineEnabled()) && !navigator.onLine) return null
    if (navigator.onLine) {
      try {
        const response = await api.get("/duty/current")
        if (response.data?.session) {
          return this.cacheServerSession(response.data.session, response.data.violations || [], response.data.week)
        }
      } catch (error) {
        console.warn("Không thể tải phiếu trực hiện tại, dùng dữ liệu đã lưu trên thiết bị.", error)
      }
    }
    return this.findCurrentLocalSession()
  }

  async loadSessionById(routeId: number) {
    if (!(await this.isOfflineEnabled()) && !navigator.onLine) return null
    const local = await this.getSessionByRouteId(routeId)
    if (!navigator.onLine || routeId < 0) return local
    try {
      const response = await api.get(`/duty/my/session/${routeId}`)
      return this.cacheServerSession(response.data.session, response.data.violations || [], response.data.week)
    } catch (error) {
      if (local) {
        console.warn("Không thể tải phiếu trực, dùng bản đã lưu trên thiết bị.", error)
        return local
      }
      throw error
    }
  }

  async listSessions() {
    return dutyStorage.listSessions(this.ownerClass)
  }

  async cacheServerSession(raw: ServerSession, rawViolations: Array<Record<string, unknown>>, rawWeek?: DutyWeekSnapshot) {
    const local = await dutyStorage.findSessionByRouteId(this.ownerClass, Number(raw.id))
    const activeOperations = await dutyStorage.listOperations(this.ownerClass)
    const hasPendingSignature = Boolean(local && activeOperations.some((item) =>
      item.clientId === local.clientId && item.kind === "sign",
    ))
    const offlineEnabled = await this.isOfflineEnabled()
    let clientId = local?.clientId || String(raw.client_id || "") || crypto.randomUUID()
    if (offlineEnabled && !raw.client_id) {
      await api.post("/duty/offline/sessions/claim", { session_id: raw.id, client_id: clientId })
    }

    const bootstrap = await this.getBootstrap()
    const week = rawWeek || local?.week || bootstrap?.week
    if (!week) throw new Error("DUTY_WEEK_MISSING")

    const remoteViolations: OfflineDutyViolation[] = rawViolations.map((item) => ({
      id: Number(item.id),
      serverId: Number(item.id),
      clientId: typeof item.client_id === "string" ? item.client_id : undefined,
      rule_id: Number(item.rule_id),
      name: String(item.name || ""),
      quantity: Number(item.quantity || 1),
      note: String(item.note || ""),
      score_delta: Number(item.score_delta || 0),
    }))
    const pendingLocal = (local?.violations || []).filter((item) => !item.serverId)
    const remoteClientIds = new Set(remoteViolations.map((item) => item.clientId).filter(Boolean))
    const violations = [...remoteViolations, ...pendingLocal.filter((item) => !item.clientId || !remoteClientIds.has(item.clientId))]
    const next: OfflineDutySession = {
      clientId,
      ownerClass: this.ownerClass,
      localId: local?.localId ?? localNumericId(),
      serverId: Number(raw.id),
      date: raw.date,
      redClass: raw.red_class,
      dutyClass: raw.duty_class,
      week,
      status: hasPendingSignature ? "signed" : raw.status,
      createdAt: raw.created_at || local?.createdAt || nowIso(),
      updatedAt: nowIso(),
      signedAt: hasPendingSignature ? local?.signedAt || null : raw.signed_at || null,
      signatureSignedAt: hasPendingSignature ? local?.signatureSignedAt || null : raw.signature_signed_at || null,
      signaturePhotoPath: raw.signature_photo_path || local?.signaturePhotoPath || null,
      bonusPoints: Number(raw.bonus_points || 0),
      violations,
    }
    await dutyStorage.putSession(next)
    return next
  }

  async addViolation(session: OfflineDutySession, rule: DutyRuleSnapshot, quantity: number, note: string) {
    if (!(await this.isOfflineEnabled())) {
      await api.post("/duty/violation", { session_id: session.serverId || session.localId, rule_id: rule.id, quantity, note })
      return (await this.loadSessionById(Number(session.serverId || session.localId))) || session
    }
    const violationClientId = crypto.randomUUID()
    const violation: OfflineDutyViolation = {
      id: localNumericId(),
      clientId: violationClientId,
      rule_id: rule.id,
      name: rule.name,
      quantity,
      note,
      score_delta: Number(rule.score_delta),
    }
    const next = { ...session, status: "draft" as const, signedAt: null, updatedAt: nowIso(), violations: [...session.violations, violation] }
    await dutyStorage.putSession(next)
    await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "add_violation", {
      violation_client_id: violationClientId,
      rule_id: rule.id,
      quantity,
      note,
    }))
    return next
  }

  async removeViolation(session: OfflineDutySession, violation: OfflineDutyViolation) {
    if (!(await this.isOfflineEnabled())) {
      await api.delete(`/duty/violation/${violation.serverId || violation.id}`)
      return (await this.loadSessionById(Number(session.serverId || session.localId))) || session
    }
    const storedSession = await dutyStorage.getSession(session.clientId)
    const storedViolation = storedSession?.violations.find((item) =>
      item.id === violation.id || (item.clientId && item.clientId === violation.clientId),
    ) || violation
    const operations = await dutyStorage.listOperations(this.ownerClass, true)
    const pendingAdd = operations.find((item) =>
      item.clientId === session.clientId &&
      item.kind === "add_violation" &&
      item.payload.violation_client_id === violation.clientId &&
      item.status === "pending",
    )
    if (pendingAdd) await dutyStorage.putOperation({ ...pendingAdd, status: "cancelled" })
    if (!pendingAdd || storedViolation.serverId) {
      await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "delete_violation", {
        violation_id: storedViolation.serverId,
        violation_client_id: storedViolation.clientId,
      }))
    }
    const next = { ...session, status: "draft" as const, signedAt: null, updatedAt: nowIso(), violations: session.violations.filter((item) => item.id !== violation.id) }
    await dutyStorage.putSession(next)
    return next
  }

  async updateViolation(session: OfflineDutySession, violation: OfflineDutyViolation, rule: DutyRuleSnapshot, quantity: number, note: string) {
    if (!(await this.isOfflineEnabled())) {
      await api.put(`/duty/violation/${violation.serverId || violation.id}`, { rule_id: rule.id, quantity, note })
      return (await this.loadSessionById(Number(session.serverId || session.localId))) || session
    }
    const storedSession = await dutyStorage.getSession(session.clientId)
    const storedViolation = storedSession?.violations.find((item) =>
      item.id === violation.id || (item.clientId && item.clientId === violation.clientId),
    ) || violation
    const operations = await dutyStorage.listOperations(this.ownerClass, true)
    const pendingAdd = operations.find((item) =>
      item.clientId === session.clientId &&
      item.kind === "add_violation" &&
      item.payload.violation_client_id === storedViolation.clientId &&
      item.status === "pending",
    )

    if (pendingAdd) {
      await dutyStorage.putOperation({
        ...pendingAdd,
        payload: { ...pendingAdd.payload, rule_id: rule.id, quantity, note },
      })
    } else {
      await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "update_violation", {
        violation_id: storedViolation.serverId,
        violation_client_id: storedViolation.clientId,
        rule_id: rule.id,
        quantity,
        note,
      }))
    }

    const next = {
      ...session,
      status: "draft" as const,
      signedAt: null,
      updatedAt: nowIso(),
      violations: session.violations.map((item) => item.id === violation.id
        ? { ...item, rule_id: rule.id, name: rule.name, quantity, note, score_delta: Number(rule.score_delta) }
        : item),
    }
    await dutyStorage.putSession(next)
    return next
  }

  async addEvidence(session: OfflineDutySession, file: File) {
    if (!(await this.isOfflineEnabled())) {
      const form = new FormData()
      form.append("files", file)
      await api.post(`/duty/session/${session.serverId || session.localId}/evidences`, form)
      return { id: crypto.randomUUID(), clientId: session.clientId, ownerClass: this.ownerClass, kind: "evidence" as const, blob: file, fileName: file.name, mimeType: file.type, byteSize: file.size, createdAt: nowIso() }
    }
    const attachmentId = crypto.randomUUID()
    const attachment: DutyOfflineAttachment = {
      id: attachmentId,
      clientId: session.clientId,
      ownerClass: this.ownerClass,
      kind: "evidence",
      blob: file,
      fileName: file.name || `minh-chung-${Date.now()}.jpg`,
      mimeType: file.type,
      byteSize: file.size,
      createdAt: nowIso(),
    }
    await dutyStorage.putAttachment(attachment)
    await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "upload_evidence", {}, [attachmentId]))
    return attachment
  }

  async listEvidence(session: OfflineDutySession) {
    return (await dutyStorage.listAttachments(session.clientId)).filter((item) => item.kind === "evidence")
  }

  async cacheServerEvidence(session: OfflineDutySession, images: Array<Record<string, unknown>>) {
    const existing = await this.listEvidence(session)
    const existingServerIds = new Set(existing.map((item) => item.serverId).filter(Boolean))
    for (const image of images) {
      const serverId = Number(image.id || 0)
      if (!serverId || existingServerIds.has(serverId)) continue
      try {
        const response = await api.get(String(image.url), { responseType: "blob" })
        await dutyStorage.putAttachment({
          id: crypto.randomUUID(),
          clientId: session.clientId,
          ownerClass: this.ownerClass,
          kind: "evidence",
          blob: response.data,
          fileName: String(image.file_name || `minh-chung-${serverId}`),
          mimeType: String(image.mime_type || response.data.type || "image/jpeg"),
          byteSize: Number(image.byte_size || response.data.size || 0),
          createdAt: String(image.created_at || nowIso()),
          serverId,
          serverUrl: String(image.url || ""),
        })
      } catch (error) {
        console.error("Không thể cache ảnh minh chứng", error)
      }
    }
  }

  async removeEvidence(session: OfflineDutySession, attachment: DutyOfflineAttachment) {
    if (!(await this.isOfflineEnabled())) {
      if (attachment.serverId) await api.delete(`/duty/evidence/${attachment.serverId}`)
      return
    }
    const storedAttachment = await dutyStorage.getAttachment(attachment.id) || attachment
    const operations = await dutyStorage.listOperations(this.ownerClass, true)
    const pendingUpload = operations.find((item) => item.kind === "upload_evidence" && item.attachmentIds.includes(attachment.id) && item.status === "pending")
    if (pendingUpload) await dutyStorage.putOperation({ ...pendingUpload, status: "cancelled" })
    if (storedAttachment.serverId) {
      await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "delete_evidence", { image_id: storedAttachment.serverId }))
    }
    await dutyStorage.deleteAttachment(attachment.id)
  }

  async queueSignature(session: OfflineDutySession, photo: File | null) {
    if (!(await this.isOfflineEnabled())) {
      const form = new FormData()
      form.append("session_id", String(session.serverId || session.localId))
      form.append("pin", "")
      if (photo) form.append("photo", photo, photo.name)
      throw new Error("ONLINE_SIGNATURE_REQUIRES_PIN")
    }
    const attachmentIds: string[] = []
    if (photo) {
      const attachment: DutyOfflineAttachment = {
        id: crypto.randomUUID(),
        clientId: session.clientId,
        ownerClass: this.ownerClass,
        kind: "signature",
        blob: photo,
        fileName: photo.name || `chu-ky-${Date.now()}.jpg`,
        mimeType: photo.type,
        byteSize: photo.size,
        createdAt: nowIso(),
      }
      await dutyStorage.putAttachment(attachment)
      attachmentIds.push(attachment.id)
    }
    await dutyStorage.putOperation(operation(this.ownerClass, session.clientId, "sign", {}, attachmentIds))
    const next = { ...session, status: "signed" as const, signedAt: nowIso(), signatureSignedAt: nowIso(), signaturePhotoPath: null, updatedAt: nowIso() }
    await dutyStorage.putSession(next)
    return next
  }
}

export function getDutyRepository(ownerClass: string) {
  let repository = repositories.get(ownerClass)
  if (!repository) {
    repository = new OfflineDutyRepository(ownerClass)
    repositories.set(ownerClass, repository)
  }
  return repository
}
