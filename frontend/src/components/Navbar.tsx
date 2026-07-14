import { useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

export default function Navbar() {

  const [menuOpen, setMenuOpen] = useState(false)
  const { user, loading, logout } = useAuth()

  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logout()
      navigate("/")
    } catch (err) {
      console.error(err)
    }
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function getDashboardPath(role: string) {

    if (role === "admin") return "/admin/dashboard"
    if (role === "gvcn") return "/gvcn/dashboard"
    if (role === "ban_can_su") return "/bancansu/dashboard"
    if (role === "co_do") return "/co_do/dashboard"

    return "/"
  }

  const dashboardPath = user ? getDashboardPath(user.role) : "/"

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 text-slate-900">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6 lg:px-8">
        <NavLink
          to="/"
          className="flex items-center gap-3 font-semibold"
          onClick={closeMenu}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2e77df] shadow-sm">
            <img src="/logowhiteonly.png" className="h-6 w-auto" alt="EDP" />
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-900">EduDiscipline Platform</span>
        </NavLink>

        <nav className="hidden md:flex ml-10 items-center gap-1 text-sm font-medium">
          {!loading && user && (
            <NavLink
              to={dashboardPath}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 transition ${isActive
                  ? "bg-[#2e77df] text-white shadow-sm"
                  : "text-slate-600 hover:bg-blue-50 hover:text-[#2e77df]"
                }`
              }
            >
              Dashboard
            </NavLink>
          )}

          <NavLink
            to="/schedule"
            className={({ isActive }) =>
              `rounded-full px-4 py-2 transition ${isActive
                ? "bg-[#2e77df] text-white shadow-sm"
                : "text-slate-600 hover:bg-blue-50 hover:text-[#2e77df]"
              }`
            }
          >
            Lịch trực
          </NavLink>
        </nav>

        <div className="hidden md:flex ml-auto items-center gap-3">
          {!loading && user ? (
            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#2e77df] hover:bg-blue-50 hover:text-[#2e77df]"
            >
              Đăng xuất
            </button>
          ) : (
            <NavLink
              to="/login"
              className="rounded-full bg-[#2e77df] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245fc0]"
            >
              Đăng nhập
            </NavLink>
          )}
        </div>

        <button
          type="button"
          aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-100 md:hidden"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="sr-only">{menuOpen ? "Đóng menu" : "Mở menu"}</span>
          <span className="flex flex-col gap-1.5">
            <span className={`block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block h-0.5 w-5 rounded-full bg-current transition-opacity duration-300 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
          </span>
        </button>
      </div>

      <div
        id="mobile-nav"
        className={`md:hidden overflow-hidden border-t border-slate-200 bg-white transition-[max-height,opacity] duration-300 ${menuOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
          }`}
      >
        <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 text-sm font-medium">
          {!loading && user && (
            <NavLink
              to={dashboardPath}
              onClick={closeMenu}
              className="rounded-2xl px-3 py-3 text-slate-700 transition hover:bg-blue-50 hover:text-[#2e77df]"
            >
              Dashboard
            </NavLink>
          )}

          <NavLink
            to="/schedule"
            onClick={closeMenu}
            className="rounded-2xl px-3 py-3 text-slate-700 transition hover:bg-blue-50 hover:text-[#2e77df]"
          >
            Lịch trực
          </NavLink>

          {user ? (
            <button
              onClick={() => {
                closeMenu()
                handleLogout()
              }}
              className="rounded-2xl px-3 py-3 text-left text-slate-700 transition hover:bg-blue-50 hover:text-[#2e77df]"
            >
              Đăng xuất
            </button>
          ) : (
            <NavLink
              to="/login"
              onClick={closeMenu}
              className="rounded-2xl px-3 py-3 text-slate-700 transition hover:bg-blue-50 hover:text-[#2e77df]"
            >
              Đăng nhập
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  )
}
