import { NavLink, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { getDashboardPath } from "../utils/authRoutes"

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V20h11V9.5" />
    </svg>
  )
}

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M7 3.5v4" />
      <path d="M17 3.5v4" />
      <path d="M4 10h16" />
      <path d="M8 14h3" />
    </svg>
  )
}

function LoginIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H4" />
      <path d="M20 4v16" />
    </svg>
  )
}

export default function Navbar() {
  const { user, loading, logout, isOffline } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logout()
      navigate("/")
    } catch (err) {
      console.error(err)
    }
  }

  const dashboardPath = user ? getDashboardPath(user.role) : "/"
  const primaryLabel = user ? "Dashboard" : "Trang chủ"
  const primaryIcon = <DashboardIcon />
  const authLabel = user ? "Đăng xuất" : "Đăng nhập"
  const authIcon = user ? <LogoutIcon /> : <LoginIcon />

  return (
    <>
      <header data-edp-desktop-navbar className="sticky top-0 z-40 hidden border-b border-slate-200/80 bg-white/95 text-slate-900 backdrop-blur md:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-3 font-semibold">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2e77df] shadow-sm">
              <img src="/logowhiteonly.png" className="h-6 w-auto" alt="EDP" />
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">
              EduDiscipline Platform
            </span>
          </NavLink>

          <nav className="ml-10 flex items-center gap-1 text-sm font-medium">
            {!loading && user && (
              <NavLink
                to={dashboardPath}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 transition ${
                    isActive
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
                `rounded-full px-4 py-2 transition ${
                  isActive
                    ? "bg-[#2e77df] text-white shadow-sm"
                    : "text-slate-600 hover:bg-blue-50 hover:text-[#2e77df]"
                }`
              }
            >
              Lịch trực
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {isOffline && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                Đang làm việc ngoại tuyến
              </span>
            )}
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
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 text-slate-900 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-md md:hidden"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)",
        }}
        aria-label="Điều hướng chính"
      >
        <div className="mx-auto grid max-w-6xl grid-cols-3 gap-1 px-3 pt-2">
          <NavLink
            to={dashboardPath}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition active:scale-[0.98] ${
                isActive
                  ? "bg-[#eff6ff] text-[#2e77df]"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`
            }
          >
            <span className="mb-1 flex h-6 w-6 items-center justify-center">
              {primaryIcon}
            </span>
            {primaryLabel}
          </NavLink>

          <NavLink
            to="/schedule"
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition active:scale-[0.98] ${
                isActive
                  ? "bg-[#eff6ff] text-[#2e77df]"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`
            }
          >
            <span className="mb-1 flex h-6 w-6 items-center justify-center">
              <ScheduleIcon />
            </span>
            Lịch trực
          </NavLink>

          {user ? (
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold text-slate-500 transition active:scale-[0.98] hover:bg-slate-50 hover:text-slate-900"
            >
              <span className="mb-1 flex h-6 w-6 items-center justify-center">
                {authIcon}
              </span>
              {authLabel}
            </button>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition active:scale-[0.98] ${
                  isActive
                    ? "bg-[#eff6ff] text-[#2e77df]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <span className="mb-1 flex h-6 w-6 items-center justify-center">
                {authIcon}
              </span>
              {authLabel}
            </NavLink>
          )}
        </div>
        {isOffline && (
          <div className="px-3 pb-1 text-center text-[11px] font-semibold text-amber-700">
            Đang làm việc ngoại tuyến
          </div>
        )}
      </nav>
    </>
  )
}
