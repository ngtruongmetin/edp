export function formatDutyStatus(status: string | null | undefined) {
  const s = String(status || "").toLowerCase()
  if (s === "signed") return "Đã ký"
  if (s === "draft") return "Nháp"
  return "Không rõ"
}

export function formatRevisionAction(action: string | null | undefined) {
  const a = String(action || "").trim()
  if (!a) return ""

  const map: Record<string, string> = {
    sign: "Ký xác nhận",
    "sign:admin": "Ký (Admin)",
    "edit:add_violation": "Thêm vi phạm",
    "edit:remove_violation": "Xóa vi phạm",
    "edit:update_violation": "Cập nhật vi phạm",
    "bonus:apply_daily_bonus": "Áp dụng điểm sổ đầu bài",
    "edit:apply_daily_bonus": "Áp dụng điểm sổ đầu bài",
  }
  if (map[a]) return map[a]

  if (a.startsWith("bonus:")) return "Điểm cộng: cập nhật"
  if (a.startsWith("edit:")) return "Chỉnh sửa phiếu"

  return "Cập nhật phiếu"
}

export function formatRevisionDetails(revision: { action?: string; metadata?: Record<string, unknown> | string | null; actor_role?: string | null }) {
  let metadata: Record<string, unknown> = {}
  if (typeof revision.metadata === "string") {
    try { metadata = JSON.parse(revision.metadata) } catch { metadata = {} }
  } else if (revision.metadata && typeof revision.metadata === "object") {
    metadata = revision.metadata
  }
  const parts: string[] = []
  if (metadata.actor_name) parts.push(String(metadata.actor_name))
  if (metadata.old_rule_name || metadata.new_rule_name) {
    parts.push(`Lỗi: ${String(metadata.old_rule_name || "Không có")} -> ${String(metadata.new_rule_name || "Không có")}`)
  } else if (metadata.rule_name) {
    parts.push(`Lỗi: ${String(metadata.rule_name)}`)
  }
  if (metadata.quantity !== undefined) parts.push(`Số lượng: ${String(metadata.quantity)}`)
  if (metadata.note) parts.push(`Ghi chú: ${String(metadata.note)}`)
  if (metadata.old_quantity !== undefined && metadata.new_quantity !== undefined) parts.push(`Số lượng: ${metadata.old_quantity} -> ${metadata.new_quantity}`)
  if (metadata.old_note !== undefined || metadata.new_note !== undefined) parts.push(`Ghi chú: ${String(metadata.old_note || "Không có")} -> ${String(metadata.new_note || "Không có")}`)
  if (metadata.violation_score !== undefined || metadata.total_points !== undefined) parts.push(`Điểm phiếu: ${String(metadata.total_points ?? metadata.violation_score)}`)
  if (metadata.status_changed && metadata.previous_status && metadata.new_status) {
    const statusLabel = (value: unknown) => String(value) === "signed" ? "Đã ký" : String(value) === "draft" ? "Nháp" : String(value)
    parts.push(`Trạng thái: ${statusLabel(metadata.previous_status)} -> ${statusLabel(metadata.new_status)}`)
  }
  return parts.join(" · ")
}
