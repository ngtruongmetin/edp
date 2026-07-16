export function getDashboardPath(role?: string | null) {
  if (role === "admin") return "/admin/dashboard"
  if (role === "gvcn") return "/gvcn/dashboard"
  if (role === "bancansu") return "/bancansu/dashboard"
  if (role === "co_do") return "/co_do/dashboard"
  return "/"
}
