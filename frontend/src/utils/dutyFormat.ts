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
