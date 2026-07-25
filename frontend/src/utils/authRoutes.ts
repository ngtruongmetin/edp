export function getDashboardPath(role?: string | null) {
  if (role === "admin") return "/admin/dashboard"
  if (role === "gvcn") return "/gvcn/dashboard"
  if (role === "ban_can_su") return "/ban_can_su/dashboard"
  if (role === "co_do") return "/co_do/dashboard"
  return "/"
}
