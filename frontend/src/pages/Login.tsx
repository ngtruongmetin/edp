import { useEffect, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../api/api"
import { useAuth } from "../auth/AuthContext"
import Navbar from "../components/Navbar"
import ClassSelector from "../components/ClassSelector"
import { usePageTitle } from "../utils/usePageTitle"
import useKeyboardInsets from "../utils/useKeyboardInsets"

const roleOptions = [
  { value: "admin", label: "Quản trị" },
  { value: "gvcn", label: "GVCN" },
  { value: "bancansu", label: "Ban cán sự" },
  { value: "co_do", label: "Cờ đỏ" },
]

export default function Login() {
  usePageTitle("EDP | Đăng nhập")
  useKeyboardInsets()

  const { user, loading } = useAuth()

  const [role, setRole] = useState("co_do")
  const [classes, setClasses] = useState<any[]>([])
  const [className, setClassName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)
  const classInputRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loading || user) return
    loadClasses()
  }, [loading, user])

  useEffect(() => {
    if (loading || user) return

    const timer = window.setTimeout(() => {
      const target =
        role === "admin"
          ? usernameRef.current
          : classInputRef.current || passwordRef.current

      target?.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loading, user, role])

  useEffect(() => {
    if (role !== "admin" && className) {
      window.setTimeout(() => {
        passwordRef.current?.focus()
      }, 0)
    }
  }, [role, className])

  if (!loading && user) {
    const dashboardPath =
      user.role === "admin"
        ? "/admin/dashboard"
        : user.role === "gvcn"
          ? "/gvcn/dashboard"
          : user.role === "bancansu"
            ? "/bancansu/dashboard"
            : "/co_do/dashboard"

    return <Navigate to={dashboardPath} replace />
  }

  async function loadClasses() {
    try {
      const res = await api.get("/classes")
      setClasses(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const changeRole = (nextRole: string) => {
    setRole(nextRole)
    setClassName("")
    setUsername("")
    setPassword("")
    setShowPassword(false)

    window.setTimeout(() => {
      const target =
        nextRole === "admin"
          ? usernameRef.current
          : classInputRef.current || passwordRef.current

      target?.focus()
    }, 0)
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    if (submitting) return

    if (role === "admin") {
      if (!username || !password) {
        toast.error("Vui lòng nhập đủ thông tin")
        return
      }
    } else {
      if (!className) {
        toast.error("Vui lòng chọn lớp")
        return
      }
      if (!password) {
        toast.error("Vui lòng nhập mật khẩu")
        return
      }
    }

    try {
      setSubmitting(true)

      if (role === "admin") {
        await api.post("/auth/admin/login", { username, password })
      } else {
        await api.post("/auth/login", {
          role,
          class_name: className,
          password,
        })
      }

      window.location.href = `/${role}/dashboard`
    } catch {
      toast.error("Sai thông tin đăng nhập")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="edp-mobile-shell bg-slate-50 text-slate-900">
      <Navbar />

      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-start px-4 py-4 sm:items-center sm:px-6 sm:py-8">
        <form
          onSubmit={submit}
          className="edp-mobile-panel edp-fade-up w-full overflow-y-auto rounded-[28px] p-5 shadow-[0_12px_36px_rgba(15,23,42,0.08)] sm:p-8"
          style={{
            maxHeight: "calc(100dvh - 5rem)",
            paddingBottom:
              "calc(1.25rem + env(safe-area-inset-bottom) + var(--edp-keyboard-offset, 0px))",
          }}
        >
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#2e77df]">
              Đăng nhập
            </p>
            <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-slate-900">
              Vào đúng vai trò, thao tác nhanh hơn
            </h1>
            <p className="max-w-[34ch] text-[15px] leading-6 text-slate-500">
              Chọn vai trò rồi đăng nhập để vào đúng màn hình làm việc.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            {roleOptions.map((option) => {
              const active = role === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeRole(option.value)}
                  className={`min-h-14 rounded-2xl border px-4 py-3 text-[15px] font-semibold transition active:scale-[0.98] ${
                    active
                      ? "border-[#2e77df] bg-[#eff6ff] text-[#2e77df]"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="mt-6 space-y-4">
            {role === "admin" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Tên người dùng
                  </label>
                  <input
                    ref={usernameRef}
                    className="edp-input w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                    placeholder="Tên đăng nhập"
                    value={username}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={(e) => {
                      e.currentTarget.scrollIntoView({
                        block: "center",
                        behavior: "smooth",
                      })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        passwordRef.current?.focus()
                      }
                    }}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      type={showPassword ? "text" : "password"}
                      className="edp-input w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-16 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                      placeholder="Mật khẩu"
                      value={password}
                      autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={(e) => {
                        e.currentTarget.scrollIntoView({
                          block: "center",
                          behavior: "smooth",
                        })
                      }}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98]"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? "Ẩn" : "Hiện"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Lớp
                  </label>
                  <ClassSelector
                    classes={classes}
                    value={className}
                    onChange={setClassName}
                    inputRef={classInputRef}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      type={showPassword ? "text" : "password"}
                      className="edp-input w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-16 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                      placeholder="Mật khẩu"
                      value={password}
                      autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={(e) => {
                        e.currentTarget.scrollIntoView({
                          block: "center",
                          behavior: "smooth",
                        })
                      }}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98]"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? "Ẩn" : "Hiện"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="mt-6 min-h-14 w-full rounded-2xl bg-[#2e77df] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#245fc0] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </main>
    </div>
  )
}
