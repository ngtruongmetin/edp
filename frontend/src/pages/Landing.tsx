import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { api } from "../api/api"
import { useAuth } from "../auth/AuthContext"
import Footer from "../components/Footer"
import Navbar from "../components/Navbar"
import usePageTitle from "../utils/usePageTitle"

type ScheduleAssignment = {
  red_class: string
  duty_class: string
}

type ScheduleWeek = {
  id: number
  week_number: number
  start_date: string
  end_date: string
  assignments: ScheduleAssignment[]
}

type LandingCompetitionItem = {
  grade: number
  class_name: string
  score: number
}

type LandingCompetition = {
  week: {
    id: number
    week_number: number
    start_date: string
    end_date: string
    closed_at: string | null
  } | null
  top_classes: LandingCompetitionItem[]
}

type PreviewState = {
  dutySessions: number
  week: ScheduleWeek | null
}

type Panel = "dashboard" | "competition"

type Feature = {
  title: string
  description: string
  icon: ReactNode
}

const ACTIVITY_START = new Date("2026-03-26T00:00:00")

function formatDateVN(dateStr: string) {
  if (!dateStr) return ""
  const [year, month, day] = dateStr.split("-")
  return `${day}/${month}/${year}`
}

function getActiveDays() {
  const today = new Date()
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const base = new Date(ACTIVITY_START.getFullYear(), ACTIVITY_START.getMonth(), ACTIVITY_START.getDate())
  const diff = localToday.getTime() - base.getTime()
  return Math.max(1, Math.floor(diff / 86400000) + 1)
}

function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    let raf = 0
    let startedAt: number | null = null

    const tick = (timestamp: number) => {
      if (startedAt === null) startedAt = timestamp
      const progress = Math.min((timestamp - startedAt) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

function IconShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-[#2e77df]">
      {children}
    </div>
  )
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string
  value: number | string
  suffix?: string
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex min-w-0 items-end gap-1">
        <div className="min-w-0 text-[clamp(1.35rem,3vw,2rem)] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
          {value}
        </div>
        {suffix ? <div className="pb-0.5 text-xs font-semibold text-slate-500">{suffix}</div> : null}
      </div>
    </div>
  )
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
      {children}
    </div>
  )
}

function HeroPreview({
  dutySessions,
  activeDays,
  currentWeek,
  panel,
  onPanelChange,
  competition,
  competitionLoading,
}: {
  dutySessions: number
  activeDays: number
  currentWeek: ScheduleWeek | null
  panel: Panel
  onPanelChange: (panel: Panel) => void
  competition: LandingCompetition | null
  competitionLoading: boolean
}) {
  const animatedDutySessions = useCountUp(dutySessions)
  const animatedActiveDays = useCountUp(activeDays)
  const animatedWeekNumber = useCountUp(currentWeek?.week_number || 0)

  const currentWeekDates = currentWeek
    ? `${formatDateVN(currentWeek.start_date)} - ${formatDateVN(currentWeek.end_date)}`
    : "Không có dữ liệu"

  const competitionWeekDates = competition?.week
    ? `${formatDateVN(competition.week.start_date)} - ${formatDateVN(competition.week.end_date)}`
    : "Không có dữ liệu"

  return (
    <div className="relative mx-auto w-full max-w-[580px]">
      <div className="absolute -left-8 top-8 h-28 w-28 rounded-full bg-[#2e77df]/10 blur-3xl" />
      <div className="absolute -bottom-8 right-0 h-32 w-32 rounded-full bg-slate-200/70 blur-3xl" />

      <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            EduDiscipline Platform
          </div>
        </div>

        <div className="grid lg:grid-cols-[220px_1fr]">
          <aside className="border-b border-slate-200 bg-slate-50/90 p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Logo Trường THPT Nguyễn Trãi - Bình Dương"
                className="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">THPT Nguyễn Trãi</div>
                <div className="text-xs text-slate-500">Bình Dương</div>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {[
                { key: "dashboard" as Panel, label: "Dashboard" },
                { key: "competition" as Panel, label: "Thi đua" },
              ].map((item) => {
                const active = panel === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onPanelChange(item.key)}
                    className={`w-full rounded-2xl px-3 py-2 text-left text-sm font-medium transition ${active ? "bg-[#2e77df] text-white" : "text-slate-600 hover:bg-slate-100"
                      }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="p-5 sm:p-6">
            {panel === "dashboard" ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Dashboard</div>
                    <div className="mt-1 text-xs text-slate-500">{currentWeekDates}</div>
                  </div>
                  <StatusPill>Đang hoạt động</StatusPill>
                </div>

                <div className="mt-5 grid gap-3">
                  <MetricCard label="Phiếu" value={animatedDutySessions} />
                  <MetricCard label="Ngày hoạt động" value={animatedActiveDays} suffix="ngày" />
                  <MetricCard label="Tuần" value={currentWeek ? animatedWeekNumber : "—"} />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Thi đua</div>
                    <div className="mt-1 text-xs text-slate-500">{competitionWeekDates}</div>
                  </div>
                  <StatusPill>
                    {competition?.week ? `Tuần ${competition.week.week_number}` : "Chưa có dữ liệu"}
                  </StatusPill>
                </div>

                <div className="mt-5 space-y-3">
                  {competitionLoading ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Đang tải kết quả...
                    </div>
                  ) : competition?.top_classes?.length ? (
                    competition.top_classes.map((item) => (
                      <div
                        key={item.grade}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Khối {item.grade}
                            </div>
                            <div className="mt-2 truncate text-sm font-semibold text-slate-900">
                              {item.class_name}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 tabular-nums">
                            {item.score} điểm
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Chưa có tuần đã tổng kết.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  usePageTitle("EduDiscipline Platform")
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  const [preview, setPreview] = useState<PreviewState>({
    dutySessions: 0,
    week: null,
  })
  const [panel, setPanel] = useState<Panel>("dashboard")
  const [competition, setCompetition] = useState<LandingCompetition | null>(null)
  const [competitionLoading, setCompetitionLoading] = useState(false)
  const activeDays = useMemo(() => getActiveDays(), [])
  useEffect(() => {
    if (!loading && user) {
      navigate(`/${user.role}/dashboard`, { replace: true })
    }
  }, [loading, navigate, user])
  useEffect(() => {
    if (loading || user) return

    let active = true

    async function loadPreview() {
      try {
        const [statsRes, scheduleRes] = await Promise.all([
          api.get("/duty/public/landing-stats"),
          api.get("/schedule"),
        ])

        let currentWeek: ScheduleWeek | null = null

        if (scheduleRes.data?.week) {
          currentWeek = {
            ...scheduleRes.data.week,
            assignments: Array.isArray(scheduleRes.data.assignments) ? scheduleRes.data.assignments : [],
          }
        } else {
          const allRes = await api.get("/schedule/all")
          const weeks = Array.isArray(allRes.data?.weeks) ? allRes.data.weeks : []
          const firstWeek = weeks[0]

          if (firstWeek) {
            currentWeek = {
              ...firstWeek,
              assignments: Array.isArray(firstWeek.assignments) ? firstWeek.assignments : [],
            }
          }
        }

        if (!active) return

        setPreview({
          dutySessions: Number(statsRes.data?.duty_sessions || 0),
          week: currentWeek,
        })
      } catch (error) {
        console.error(error)
      }
    }

    loadPreview()

    return () => {
      active = false
    }
  }, [loading, user])

  useEffect(() => {
    if (loading || user) return

    let active = true

    async function loadCompetition() {
      try {
        setCompetitionLoading(true)
        const res = await api.get("/duty/public/landing-competition")

        if (!active) return

        setCompetition({
          week: res.data?.week || null,
          top_classes: Array.isArray(res.data?.top_classes) ? res.data.top_classes : [],
        })
      } catch (error) {
        console.error(error)
      } finally {
        if (active) setCompetitionLoading(false)
      }
    }

    loadCompetition()

    return () => {
      active = false
    }
  }, [loading, user])

  const features: Feature[] = [
    {
      title: "Phiếu trực",
      description: "Ghi nhận trực nhật nhanh chóng.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4h10a2 2 0 0 1 2 2v12H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M9 8h6" />
            <path d="M9 12h6" />
            <path d="M9 16h4" />
          </svg>
        </IconShell>
      ),
    },
    {
      title: "Sổ đầu bài",
      description: "Theo dõi tình hình lớp học.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z" />
            <path d="M8 4v14" />
            <path d="M10 8h5" />
            <path d="M10 12h5" />
          </svg>
        </IconShell>
      ),
    },
    {
      title: "Thi đua",
      description: "Tổng hợp điểm theo tuần.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18h16" />
            <path d="M6 14V9" />
            <path d="M12 14V6" />
            <path d="M18 14v-4" />
          </svg>
        </IconShell>
      ),
    },
    {
      title: "Dashboard",
      description: "Theo dõi toàn trường.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h7v5H4z" />
            <path d="M13 6h7v8h-7z" />
            <path d="M4 13h7v5H4z" />
            <path d="M13 16h7v2h-7z" />
          </svg>
        </IconShell>
      ),
    },
    {
      title: "Lịch trực",
      description: "Xem phân công theo tuần.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4" />
            <path d="M16 3v4" />
            <path d="M4 9h16" />
          </svg>
        </IconShell>
      ),
    },
    {
      title: "Ký xác nhận",
      description: "Xác nhận phiếu và lưu vết.",
      icon: (
        <IconShell>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 12l3 3 7-7" />
            <path d="M6 4h12a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          </svg>
        </IconShell>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-xl edp-fade-up">
            <img
              src="/logo.png"
              alt="Logo Trường THPT Nguyễn Trãi - Bình Dương"
              className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-cover shadow-sm"
            />

            <h1 className="mt-6 max-w-md text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              EduDiscipline Platform
            </h1>

            <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">
              Hệ thống quản lý thi đua cờ đỏ tại Trường THPT Nguyễn Trãi - Bình Dương.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/login"
                className="inline-flex w-full items-center justify-center rounded-2xl bg-[#2e77df] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[#245fc0] sm:w-auto"
              >
                Đăng nhập
              </Link>
              <Link
                to="/schedule"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto"
              >
                Xem lịch trực
              </Link>
            </div>
          </div>

          <div className="edp-fade-up-delay">
            <HeroPreview
              dutySessions={preview.dutySessions}
              activeDays={activeDays}
              currentWeek={preview.week}
              panel={panel}
              onPanelChange={setPanel}
              competition={competition}
              competitionLoading={competitionLoading}
            />
          </div>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.06)]"
            >
              {feature.icon}
              <div className="mt-4 text-sm font-semibold text-slate-900">{feature.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</div>
            </div>
          ))}
        </section>
      </main>

      <Footer />
    </div>
  )
}
