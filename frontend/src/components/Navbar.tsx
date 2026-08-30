import { useEffect, useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import ModalShell from "./ModalShell"
import { getDashboardPath } from "../utils/authRoutes"
import { useOptionalDutyOffline } from "../offline/duty/DutyOfflineContext"

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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08A1.7 1.7 0 0 0 10.68 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 15a1.7 1.7 0 0 0-1.56-1.03h-.08v-3h.08A1.7 1.7 0 0 0 7.02 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.64h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  )
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 18.5 4 21l3.5-1.2A8.5 8.5 0 1 0 3.5 12c0 1.65.47 3.19 1.28 4.5" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.4" />
    </svg>
  )
}

export default function Navbar() {
  const { user, loading, logout, isOffline } = useAuth()
  const dutyOffline = useOptionalDutyOffline()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [supportUnreadCount, setSupportUnreadCount] = useState(0)

  useEffect(() => {
    if (!user || loading || isOffline) {
      setSupportUnreadCount(0)
      return
    }

    let active = true
    const loadUnreadCount = async () => {
      try {
        const response = await fetch("/api/support/notifications/unread-count", { credentials: "include" })
        if (!response.ok) return
        const data = await response.json() as { count?: number }
        if (active) setSupportUnreadCount(Math.max(0, Number(data.count || 0)))
      } catch {
        // The support badge remains hidden when its non-critical request is unavailable.
      }
    }

    void loadUnreadCount()
    window.addEventListener("support-notifications-read", loadUnreadCount)
    const timer = window.setInterval(() => void loadUnreadCount(), 60000)
    return () => {
      active = false
      window.removeEventListener("support-notifications-read", loadUnreadCount)
      window.clearInterval(timer)
    }
  }, [isOffline, loading, user])

  async function handleLogout() {
    setIsLoggingOut(true)
    try {
      await logout()
      navigate("/")
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoggingOut(false)
      setShowLogoutConfirm(false)
    }
  }

  function openLogoutConfirm() {
    if (isLoggingOut) return
    setShowLogoutConfirm(true)
  }

  function closeLogoutConfirm() {
    if (isLoggingOut) return
    setShowLogoutConfirm(false)
  }

  const dashboardPath = user ? getDashboardPath(user.role) : "/"
  const primaryLabel = user ? "Dashboard" : "Trang chủ"
  const primaryIcon = <DashboardIcon />
  const authLabel = user ? "Đăng xuất" : "Đăng nhập"
  const authIcon = user ? <LogoutIcon /> : <LoginIcon />
  const dutySyncLabel = user?.role !== "co_do" || !dutyOffline
    ? null
    : dutyOffline.status.phase === "offline"
      ? !dutyOffline.readiness.ready
        ? "Thiết bị chưa sẵn sàng làm việc ngoại tuyến."
        : dutyOffline.status.pending > 0
          ? `Đang ngoại tuyến · Có ${dutyOffline.status.pending} phiên trực chờ đồng bộ`
          : "Đang làm việc ngoại tuyến"
      : dutyOffline.readiness.syncing
        ? "Đang chuẩn bị dữ liệu ngoại tuyến"
      : dutyOffline.status.phase === "syncing"
        ? `Đang đồng bộ ${dutyOffline.status.completed} / ${dutyOffline.status.total}`
        : dutyOffline.status.phase === "error"
          ? `Không thể đồng bộ · ${dutyOffline.status.pendingOperations} thao tác`
          : dutyOffline.status.phase === "synced" && dutyOffline.status.total > 0
            ? "Đồng bộ thành công"
            : dutyOffline.readiness.ready
              ? "Thiết bị đã sẵn sàng làm việc ngoại tuyến"
              : "Thiết bị chưa sẵn sàng làm việc ngoại tuyến."

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

            {!loading && user && (
              <NavLink
                to="/account/settings"
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 transition ${
                    isActive
                      ? "bg-[#2e77df] text-white shadow-sm"
                      : "text-slate-600 hover:bg-blue-50 hover:text-[#2e77df]"
                  }`
                }
              >
                Cài đặt
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

            {!loading && user && (
              <NavLink
                to="/support"
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 transition ${
                    isActive
                      ? "bg-[#2e77df] text-white shadow-sm"
                      : "text-slate-600 hover:bg-blue-50 hover:text-[#2e77df]"
                  }`
                }
              >
                Hỗ trợ{supportUnreadCount > 0 ? ` (${supportUnreadCount})` : ""}
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {dutySyncLabel && (
                <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${dutyOffline?.readiness.ready || dutyOffline?.status.phase === "synced" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {dutySyncLabel}
              </span>
            )}
            {!loading && user ? (
              <button
                type="button"
                onClick={openLogoutConfirm}
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
        <div className={`mx-auto grid max-w-6xl gap-1 px-3 pt-2 ${user ? "grid-cols-5" : "grid-cols-3"}`}>
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

          {user && (
            <NavLink
              to="/support"
              className={({ isActive }) =>
                `relative flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 py-2 text-[11px] font-semibold transition active:scale-[0.98] ${
                  isActive
                    ? "bg-[#eff6ff] text-[#2e77df]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <span className="relative mb-1 flex h-6 w-6 items-center justify-center">
                <SupportIcon />
                {supportUnreadCount > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2e77df] px-1 text-[9px] leading-none text-white">
                    {supportUnreadCount > 9 ? "9+" : supportUnreadCount}
                  </span>
                )}
              </span>
              Hỗ trợ
            </NavLink>
          )}

          {user && (
            <NavLink
              to="/account/settings"
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition active:scale-[0.98] ${
                  isActive
                    ? "bg-[#eff6ff] text-[#2e77df]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <span className="mb-1 flex h-6 w-6 items-center justify-center"><SettingsIcon /></span>
              Cài đặt
            </NavLink>
          )}

          {user ? (
            <button
              type="button"
              onClick={openLogoutConfirm}
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
        {dutySyncLabel && (
          <div className={`px-3 pb-1 text-center text-[11px] font-semibold ${dutyOffline?.readiness.ready || dutyOffline?.status.phase === "synced" ? "text-emerald-700" : "text-amber-700"}`}>
            {dutySyncLabel}
          </div>
        )}
      </nav>

      {showLogoutConfirm && (
        <ModalShell className="edp-glass-panel edp-spring-in max-w-md rounded-[26px] p-6 sm:p-7">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Đăng xuất
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px]">
              Bạn có chắc chắn muốn đăng xuất khỏi EduDiscipline Platform không?
            </p>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeLogoutConfirm}
              disabled={isLoggingOut}
              className="min-h-11 rounded-[18px] border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  )
}
