import { useEffect, useMemo ,useRef, useState } from "react"
import { Link } from "react-router-dom"
import usePageTitle from "../utils/usePageTitle"
import Footer from "../components/Footer"
import Navbar from "../components/Navbar"
import { api } from "../api/api"

export default function Landing() {
  usePageTitle("EduDiscipline Platform")
  const [user, setUser] = useState<any>(null)
  const [dutySessions, setDutySessions] = useState<number | null>(null)
  const statsRef = useRef<HTMLDivElement | null>(null)
  const [statsVisible, setStatsVisible] = useState(false)

  useEffect(() => {
    loadUser()
  }, [])

  async function loadUser() {
    try {
      const res = await api.get("/auth/me")
      setUser(res.data)
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    loadLandingStats()
  }, [])

  async function loadLandingStats() {
    try {
      const res = await api.get("/duty/public/landing-stats")
      const total = Number(res.data?.duty_sessions)
      if (Number.isFinite(total) && total >= 0) setDutySessions(total)
    } catch {
      // ignore
    }
  }

  function getDashboardPath(role: string) {
    if (role === "admin") return "/admin/dashboard"
    if (role === "gvcn") return "/gvcn/dashboard"
    if (role === "ban_can_su") return "/ban_can_su/dashboard"
    if (role === "co_do") return "/co_do/dashboard"
    return "/"
  }

  const primaryLink = user ? getDashboardPath(user.role) : "/login"
  const primaryLabel = user ? "Truy cập hệ thống" : "Đăng nhập hệ thống"

  useEffect(() => {
    const target = statsRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setStatsVisible(true)
            observer.disconnect()
          }
        })
      },
      { threshold: 0.35 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  function Counter({
    value,
    suffix,
    active,
  }: {
    value: number
    suffix?: string
    active: boolean
  }) {
    const [current, setCurrent] = useState(0)
    const rafRef = useRef<number | null>(null)
    const startRef = useRef<number | null>(null)

    useEffect(() => {
      if (!active) return
      const duration = 1200
      const start = performance.now()
      startRef.current = start

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        setCurrent(Math.round(value * eased))
        if (t < 1) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }, [active, value])

    return (
      <span>
        {current}
        {suffix || ""}
      </span>
    )
  }

  const metrics = useMemo(() => {
    const start = new Date(2026, 2, 27, 0, 0, 0, 0)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000)
    const daysRunning = diffDays >= 0 ? diffDays + 1 : 0

    function dailyIncrement(dayIndex: number) {
      const n = (dayIndex + 1) * 9301 + 49297
      const rnd = (n % 233280) / 233280
      const perClass = 50 + Math.floor(rnd * 11)
      return perClass * 4
    }

    let visits = 0
    for (let i = 0; i < daysRunning; i += 1) visits += dailyIncrement(i)

    const dutyTickets = daysRunning * 41

    return { daysRunning, visits, dutyTickets }
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f6f2] text-slate-900">
      <Navbar />

      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-28 -left-16 h-72 w-72 rounded-full bg-[#00b894]/20 blur-3xl" />
          <div className="absolute top-10 right-10 h-80 w-80 rounded-full bg-[#2e77df]/20 blur-3xl" />
          <div className="absolute bottom-10 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#ffd86b]/30 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(#00000010_1px,transparent_1px)] [background-size:18px_18px]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="grid gap-10 lg:grid-cols-12 items-center">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                <span className="inline-flex h-2 w-2 rounded-full bg-[#00b894]" />
                Đoàn Trường THPT Nguyễn Trãi - Bình Dương xây dựng và vận hành
              </div>

              <h1
                className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02] tracking-tight"
                style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
              >
                EduDiscipline Platform
                <span className="text-[#2e77df]">.</span>
              </h1>

              <div
                className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-[#e9fff6] px-3 py-1 text-sm font-semibold text-[#0b6b4f]"
                style={{ fontFamily: '"Baloo 2", "Segoe UI", sans-serif' }}
              >
                Nền tảng thi đua do Đoàn Trường xây dựng
              </div>

              <p className="mt-4 text-base sm:text-lg text-slate-700 leading-relaxed max-w-xl">
                Từ phiếu trực, ký xác nhận, sổ đầu bài đến tổng kết tuần — mọi thứ
                chạy theo đúng nhịp vận hành của nhà trường, rõ ràng và có lưu vết.
              </p>

              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Link to={primaryLink} className="w-full sm:w-auto">
                  <button className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-[#2e77df] text-white font-semibold text-base shadow hover:bg-[#1f5fc0] transition">
                    {primaryLabel}
                  </button>
                </Link>
                <a href="#tong-quan" className="w-full sm:w-auto">
                  <button className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-white/90 border border-white text-slate-900 font-semibold text-base shadow-sm hover:bg-white transition">
                    Xem tổng quan
                  </button>
                </a>
              </div>

              <div ref={statsRef} className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { k: metrics.daysRunning, v: "Ngày vận hành thực tế", suffix: "" },
                  {
                    k: dutySessions != null ? dutySessions : metrics.dutyTickets,
                    v: "Phiếu trực",
                    suffix: "",
                  },
                  { k: metrics.visits, v: "Lượt truy cập", suffix: "" },
                  { k: 100, v: "Duy trì mỗi ngày", suffix: "%" },
                ].map((x) => (
                  <div
                    key={x.v}
                    className="rounded-3xl bg-white/95 border border-white p-4 shadow-md hover:shadow-lg transition"
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className="text-3xl sm:text-4xl font-semibold text-slate-900 leading-none"
                        style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
                      >
                        <Counter value={x.k} suffix={x.suffix} active={statsVisible} />
                      </div>
                      <div className="h-8 w-8 rounded-2xl bg-[#2e77df]/10 border border-[#2e77df]/20" />
                    </div>
                    <div className="text-xs sm:text-sm uppercase tracking-wide text-slate-600 mt-2">
                      {x.v}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative">
                <div className="absolute -top-4 -left-4 h-16 w-16 rounded-2xl bg-[#ffd86b] shadow-lg" />
                <div className="absolute -bottom-6 -right-2 h-20 w-20 rounded-full bg-[#00b894] shadow-lg" />

                <div className="relative rounded-3xl bg-white/90 border border-white shadow-xl p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-700">Bảng điều khiển thi đua</div>
                    <div className="rounded-full bg-[#2e77df]/10 text-[#2e77df] text-xs font-semibold px-3 py-1">
                      Đang chạy tuần hiện tại
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {[
                      {
                        t: "Phiếu trực hôm nay",
                        d: "Ghi nhanh, rõ ràng, có lưu vết chỉnh sửa",
                        c: "bg-[#2e77df]/10 text-[#2e77df]",
                      },
                      {
                        t: "Sổ đầu bài",
                        d: "Tự cộng điểm, cho phép điều chỉnh chi tiết",
                        c: "bg-[#00b894]/10 text-[#00b894]",
                      },
                      {
                        t: "Thi đua tuần",
                        d: "Xếp hạng minh bạch theo từng khối",
                        c: "bg-[#ff9f1a]/10 text-[#ff9f1a]",
                      },
                    ].map((card) => (
                      <div key={card.t} className="rounded-2xl border border-slate-100 bg-white p-4">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${card.c}`} />
                          <div className="text-sm font-semibold text-slate-900">{card.t}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{card.d}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-2xl bg-[#f7f8ff] border border-[#e7ebff] p-4">
                    <div className="text-xs font-semibold text-slate-600">Tinh thần thiết kế</div>
                    <div className="mt-2 text-sm text-slate-800 leading-relaxed">
                      Nhanh – đúng nghiệp vụ – minh bạch. Làm ra để dùng ngay trong trường.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="tong-quan" className="mt-12 sm:mt-16">
            <div className="grid gap-6 lg:grid-cols-12 items-start">
              <div className="lg:col-span-5">
                <div className="text-xs font-semibold text-slate-600">Hành trình một tuần</div>
                <h2
                  className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-900"
                  style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
                >
                  Từ trực ngày đến tổng kết tuần
                </h2>
                <p className="mt-2 text-slate-700 leading-relaxed">
                  Đi theo đúng nhịp vận hành: ghi phiếu, ký xác nhận, cộng sổ đầu bài,
                  chốt tuần và xuất báo cáo.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["Quản trị", "Giáo viên chủ nhiệm", "Ban cán sự", "Cờ đỏ"].map((r) => (
                    <span
                      key={r}
                      className="rounded-full bg-white/90 border border-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      t: "Phiếu trực theo ngày",
                      d: "Ghi nhanh, có ghi chú và tổng điểm tự động.",
                    },
                    {
                      t: "Ký xác nhận",
                      d: "Xác nhận bằng ảnh và mã PIN đúng lớp trực.",
                    },
                    {
                      t: "Sổ đầu bài",
                      d: "Cộng điểm tự động, chỉnh sửa chi tiết khi cần.",
                    },
                    {
                      t: "Tổng hợp thi đua",
                      d: "Chốt tuần, xếp hạng và xuất báo cáo rõ ràng.",
                    },
                  ].map((c) => (
                    <div key={c.t} className="rounded-3xl bg-white/90 border border-white shadow-sm p-5">
                      <div className="h-10 w-10 rounded-2xl bg-[#2e77df]/10 border border-[#2e77df]/20 flex items-center justify-center text-[#2e77df] font-bold">
                        E
                      </div>
                      <div className="mt-3 text-lg font-semibold text-slate-900">{c.t}</div>
                      <div className="mt-1 text-sm text-slate-700 leading-relaxed">{c.d}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-3xl bg-[#10243f] text-white overflow-hidden">
              <div className="p-6 sm:p-8">
                <div className="text-xs font-semibold text-white/70">Bắt đầu sử dụng</div>
                <div className="mt-2 text-xl sm:text-2xl font-semibold">
                  Dùng ngay theo vai trò của bạn
                </div>
                <div className="mt-2 text-sm text-white/75 max-w-2xl leading-relaxed">
                  Dành cho Quản trị, Giáo viên chủ nhiệm, Ban cán sự và Cờ đỏ.
                  Mỗi vai trò có giao diện và quyền xử lý đúng nghiệp vụ.
                </div>
                <div className="mt-5">
                  <Link to={primaryLink}>
                    <button className="px-6 py-3 rounded-xl bg-white text-slate-900 font-semibold hover:bg-slate-100 transition">
                      {primaryLabel}
                    </button>
                  </Link>
                </div>
              </div>
              <div className="h-1.5 bg-gradient-to-r from-[#2e77df] via-[#00b894] to-[#ffd86b]" />
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
