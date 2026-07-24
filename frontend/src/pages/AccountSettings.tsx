import { useState } from "react"
import { Link, Navigate } from "react-router-dom"

import { useAuth } from "../auth/AuthContext"
import ChangePasswordModal from "../components/ChangePasswordModal"
import Footer from "../components/Footer"
import Navbar from "../components/Navbar"
import { usePageTitle } from "../utils/usePageTitle"

type AccountRole = "admin" | "gvcn" | "bancansu" | "co_do"

function PasskeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="3" />
      <path d="M10.1 12.9 20 3m-3 0h3v3m-7 4 2 2m1-5 2 2" />
    </svg>
  )
}

function PasswordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function isAccountRole(role: string | undefined): role is AccountRole {
  return role === "admin" || role === "gvcn" || role === "bancansu" || role === "co_do"
}

export default function AccountSettings() {
  usePageTitle("EDP | Cài đặt")
  const { user, loading } = useAuth()
  const [showChangePassword, setShowChangePassword] = useState(false)

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!user || !isAccountRole(user.role)) return null

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)] text-slate-900">
      <Navbar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 pb-28 sm:px-6 sm:pb-8 lg:px-8">
        <section className="edp-glass-panel rounded-[32px] px-6 py-7 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">Tài khoản</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Cài đặt</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Quản lý bảo mật và thông tin đăng nhập của tài khoản hiện tại.
          </p>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6" aria-labelledby="security-heading">
          <div className="border-b border-slate-200 pb-4">
            <h2 id="security-heading" className="text-lg font-semibold text-slate-900">Bảo mật</h2>
          </div>

          <div className="divide-y divide-slate-100">
            <Link
              to="/account/passkeys"
              className="group flex min-h-24 items-center gap-4 py-5 transition hover:bg-blue-50/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-[#eff6ff] text-[#2e77df]">
                <PasskeyIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-slate-900">Quản lý Passkey</span>
                <span className="mt-1 block max-w-2xl text-sm leading-6 text-slate-500">
                  Đăng ký và quản lý Passkey để đăng nhập bằng vân tay, Face ID hoặc Windows Hello.
                </span>
              </span>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition group-hover:bg-white group-hover:text-[#2e77df]">
                <ChevronRightIcon />
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="group flex min-h-24 w-full items-center gap-4 py-5 text-left transition hover:bg-blue-50/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-[#eff6ff] text-[#2e77df]">
                <PasswordIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-slate-900">Đổi mật khẩu</span>
                <span className="mt-1 block max-w-2xl text-sm leading-6 text-slate-500">
                  Thay đổi mật khẩu đăng nhập tài khoản.
                </span>
              </span>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition group-hover:bg-white group-hover:text-[#2e77df]">
                <ChevronRightIcon />
              </span>
            </button>
          </div>
        </section>
      </main>
      <Footer />

      {showChangePassword && (
        <ChangePasswordModal role={user.role} canClose onSuccess={() => setShowChangePassword(false)} />
      )}
    </div>
  )
}
