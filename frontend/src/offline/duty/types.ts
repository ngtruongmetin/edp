export type DutyQueueStatus = "pending" | "syncing" | "completed" | "failed" | "cancelled"

export type DutyOperationKind =
  | "create_session"
  | "add_violation"
  | "update_violation"
  | "delete_violation"
  | "upload_evidence"
  | "delete_evidence"
  | "sign"

export interface DutyWeekSnapshot {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

export interface DutyRuleSnapshot {
  id: number
  name: string
  score_delta: number
  [key: string]: unknown
}

export interface DutyOfflineClassSnapshot {
  id: number
  name: string
  grade: number
  is_active: number
}

export interface DutyOfflineCommitteeSnapshot {
  account_id: number
  class_id: number
  class_name: string
  pin_hash: string
  pin_version: number
}

export interface DutyOfflineAssignmentSnapshot {
  red_class: string
  duty_class: string
}

export interface DutyOfflineDataSnapshot {
  version: 1
  data_version: string
  generated_at: string
  valid_until: string | null
  owner_class: string
  week: DutyWeekSnapshot
  assignments: DutyOfflineAssignmentSnapshot[]
  classes: DutyOfflineClassSnapshot[]
  committees: DutyOfflineCommitteeSnapshot[]
  rules: DutyRuleSnapshot[]
}

export interface DutyOfflineManifest {
  version: 1
  data_version: string
  generated_at: string
  valid_until: string | null
  owner_class: string
  week_id: number | null
}

export interface DutyOfflineReadiness {
  ready: boolean
  syncing: boolean
  syncedAt?: string
  error?: string
}

export interface OfflineDutyViolation {
  id: number
  serverId?: number
  clientId?: string
  rule_id: number
  name: string
  quantity: number
  note: string
  score_delta: number
}

export interface OfflineDutySession {
  clientId: string
  ownerClass: string
  localId: number
  serverId?: number
  date: string
  redClass: string
  dutyClass: string
  week: DutyWeekSnapshot
  status: "draft" | "signed"
  createdAt: string
  updatedAt: string
  signedAt?: string | null
  signatureSignedAt?: string | null
  signaturePhotoPath?: string | null
  bonusPoints: number
  violations: OfflineDutyViolation[]
}

export interface DutyOfflineOperation {
  id: string
  clientId: string
  ownerClass: string
  kind: DutyOperationKind
  createdAt: string
  payload: Record<string, unknown>
  attachmentIds: string[]
  status: DutyQueueStatus
  retryCount: number
  nextAttemptAt: number
  lastError?: string
  completedAt?: string
}

export interface DutyOfflineAttachment {
  id: string
  clientId: string
  ownerClass: string
  kind: "evidence" | "signature"
  blob: Blob
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
  serverId?: number
  serverUrl?: string
}

export interface OfflinePinAttemptState {
  key: string
  failedAttempts: number
  lockedUntil: number
  updatedAt: string
}

export interface DutySyncStatus {
  isOnline: boolean
  phase: "offline" | "idle" | "syncing" | "synced" | "error"
  pending: number
  pendingOperations: number
  completed: number
  total: number
  lastError?: string
}
