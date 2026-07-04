import { useEffect, useState } from "react"
import { api } from "../api/api"
import Navbar from "../components/Navbar"
import ClassSelector from "../components/ClassSelector"
import { usePageTitle } from "../utils/usePageTitle"
import toast from "react-hot-toast"

const roleOptions = [
  { value: "admin", label: "Quản trị" },
  { value: "gvcn", label: "GVCN" },
  { value: "bancansu", label: "Ban cán sự" },
  { value: "co_do", label: "Cờ đỏ" },
]

export default function Login() {
  usePageTitle("EDP | Đăng nhập")

  const [role, setRole] = useState("co_do")
  const [classes, setClasses] = useState<any[]>([])
  const [className, setClassName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadClasses()
    checkLogin()
  }, [])

  async function loadClasses() {
    try {
      const res = await api.get("/classes")
      setClasses(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  async function checkLogin() {
    try {
      const res = await api.get("/auth/me")
      window.location.href = `/${res.data.role}/dashboard`
    } catch {}
  }

  const changeRole = (nextRole: string) => {
    setRole(nextRole)
    setClassName("")
    setUsername("")
    setPassword("")
    setShowPassword(false)
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    try {
      setSubmitting(true)

      if (role === "admin") {
        if (!username || !password) {
          toast.error("Vui lòng nhập đủ thông tin")
          return
        }
        await api.post("/auth/admin/login", { username, password })
      } else {
        if (!className) {
          toast.error("Vui lòng chọn lớp")
          return
        }
        if (!password) {
          toast.error("Vui lòng nhập mật khẩu")
          return
        }
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />

      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center px-4 py-10 sm:px-6">
        <form
          onSubmit={submit}
          className="w-full rounded-3xl border border-[#dbeafe] bg-white p-6 shadow-sm sm:p-8 edp-fade-up"
        >
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Đăng nhập
          </h1>
          <p className="mt-2 text-sm text-slate-500">Chọn vai trò rồi nhập thông tin.</p>

          <div className="mt-6 grid grid-cols-2 gap-2">
            {roleOptions.map((option) => {
              const active = role === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeRole(option.value)}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
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
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Tên người dùng</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                    placeholder="Tên đăng nhập"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Mật khẩu</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-14 text-[15px] shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                      placeholder="Mật khẩu"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
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
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Lớp</label>
                  <ClassSelector classes={classes} value={className} onChange={setClassName} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Mật khẩu</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-14 text-[15px] shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
                      placeholder="Mật khẩu"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
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
            className="mt-6 w-full rounded-2xl bg-[#2e77df] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245fc0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </main>
    </div>
  )
}
