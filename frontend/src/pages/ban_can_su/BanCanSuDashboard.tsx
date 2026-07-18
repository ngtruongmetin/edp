import { useEffect, useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import DutyPeriodSelector, { type DutyPeriodTree } from "../../components/DutyPeriodSelector"
import DutyPeriodSummaryCard, { type DutyPeriodSummary } from "../../components/DutyPeriodSummaryCard"
import { formatDutyStatus } from "../../utils/dutyFormat"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { buildDashboardCacheKey, getCachedDashboard, setCachedDashboard } from "../../utils/offlineCache"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
  base_points?: number
  month_key?: string
  semester_key?: string
}

type Session = {
  id: number
  week_id: number
  date: string
  red_class: string
  duty_class: string
  status: string
  total_score: number
  violation_score: number
  bonus_points: number
  signature_photo_path?: string | null
}

type DashboardSnapshot = {
  periodTree: DutyPeriodTree | null
  weeks: Week[]
  semesterKey: string
  monthKey: string
  weekId: number | null
  week: Week | null
  sessions: Session[]
  summary: DutyPeriodSummary | null
}

export default function BanCanSuDashboard() {
  usePageTitle("EDP | Ban cán sự")
  const { user: authUser, isOffline } = useAuth()
  const context = useOutletContext<any>()
  const user = context?.user
  const setShowChangePassword = context?.setShowChangePassword as
    | ((open: boolean) => void)
    | undefined

  const [time, setTime] = useState("")
  const [todayDate, setTodayDate] = useState("")

  const [weeks, setWeeks] = useState<Week[]>([])
  const [periodTree, setPeriodTree] = useState<DutyPeriodTree | null>(null)
  const [semesterKey, setSemesterKey] = useState("")
  const [monthKey, setMonthKey] = useState("")
  const [weekId, setWeekId] = useState<number | null>(null)
  const [week, setWeek] = useState<Week | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<DutyPeriodSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<any>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const h = String(now.getHours()).padStart(2, "0")
      const mi = String(now.getMinutes()).padStart(2, "0")
      const s = String(now.getSeconds()).padStart(2, "0")
      setTime(`${h}:${mi}:${s}`)

      const d = String(now.getDate()).padStart(2, "0")
      const m = String(now.getMonth() + 1).padStart(2, "0")
      const y = now.getFullYear()
      setTodayDate(`${d}/${m}/${y}`)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    async function loadCachedSnapshot() {
      try {
        const cacheKey = buildDashboardCacheKey(authUser)
        const cached = await getCachedDashboard<DashboardSnapshot>(cacheKey)

        if (!cached) {
          setLoading(false)
          return
        }

        setPeriodTree(cached.periodTree || null)
        setWeeks(cached.weeks || [])
        setSemesterKey(cached.semesterKey || "")
        setMonthKey(cached.monthKey || "")
        setWeekId(cached.weekId ?? null)
        setWeek(cached.week || null)
        setSessions(cached.sessions || [])
        setSummary(cached.summary || null)
      } catch (err) {
        console.error(err)
      } finally {
        if (isOffline) {
          setLoading(false)
        }
      }
    }

    void loadCachedSnapshot()
  }, [authUser, isOffline])

  useEffect(() => {
    if (!user?.class_name || isOffline) return
    loadWeeks()
  }, [user?.class_name, isOffline])

  useEffect(() => {
    if (isOffline) return
    if (weekId) {
      loadWeekSessions(weekId)
      loadWeekSummary(weekId)
      return
    }

    setWeek(null)
    setSessions([])
    if (monthKey) {
      loadPeriodSummary("month", monthKey)
      return
    }
    if (semesterKey) {
      loadPeriodSummary("semester", semesterKey)
      return
    }
    const yearKey = periodTree?.school_year?.year_key
    if (yearKey) {
      loadPeriodSummary("year", yearKey)
    }
  }, [weekId, monthKey, semesterKey, periodTree?.school_year?.year_key, isOffline])

  useEffect(() => {
    if (!weeks.length && !week && !sessions.length && !summary) return

    const cacheKey = buildDashboardCacheKey(authUser)

    void setCachedDashboard(cacheKey, {
      periodTree,
      weeks,
      semesterKey,
      monthKey,
      weekId,
      week,
      sessions,
      summary,
    })
  }, [authUser, periodTree, weeks, semesterKey, monthKey, weekId, week, sessions, summary])

  async function loadWeeks() {
    try {
      const res = await api.get("/duty/bancansu/period-tree")
      const tree = res.data as DutyPeriodTree
      const list: Week[] = (tree.semesters || []).flatMap((semester) =>
        (semester.months || []).flatMap((month) =>
          (month.weeks || []).map((week) => ({
            ...week,
            month_key: month.month_key,
            semester_key: semester.semester_key,
          })),
        ),
      )
      setPeriodTree(tree)
      setWeeks(list)

      const today = new Date()
      const todayIso = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      ].join("-")

      const current = list.find((w) => w.start_date <= todayIso && todayIso <= w.end_date)
      const defaultWeekId = current?.id ?? list[0]?.id ?? null
      const defaultWeek = list.find((item) => item.id === defaultWeekId) || null
      const firstSemester = tree.semesters?.[0] || null
      setSemesterKey(defaultWeek?.semester_key || firstSemester?.semester_key || "")
      setMonthKey(defaultWeek?.month_key || "")
      setWeekId(defaultWeekId)
    } catch (err: any) {
      console.error(err)
      toast.error(getApiErrorMessage(err, "Không thể tải cây thời gian"))
    }
  }

  async function loadWeekSessions(id: number) {
    try {
      setLoading(true)
      const res = await api.get(`/duty/bancansu/week/${id}`)
      setWeek(
        res.data.week
          ? {
              ...res.data.week,
              base_points: Number(res.data.base_points || 120),
            }
          : null,
      )
      setSessions(res.data.sessions || [])
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.error || "Không thể tải danh sách phiếu trong tuần"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function loadWeekSummary(id: number) {
    try {
      setSummaryLoading(true)
      const res = await api.get(`/duty/bancansu/week/${id}/summary`)
      setSummary(res.data)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tải tổng kết tuần"))
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }

  async function loadPeriodSummary(type: "month" | "semester" | "year", key: string) {
    try {
      setSummaryLoading(true)
      const res = await api.get(`/duty/bancansu/${type}/${encodeURIComponent(key)}/summary`)
      setSummary(res.data)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tải tổng kết"))
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }

  function handleSemesterChange(value: string) {
    setSemesterKey(value)
    setMonthKey("")
    setWeekId(null)
    setWeek(null)
    setSessions([])
  }

  function handleMonthChange(value: string) {
    setMonthKey(value)
    setWeekId(null)
    setWeek(null)
    setSessions([])
  }

  function handleWeekChange(value: number | null) {
    setWeekId(value)
    if (!value) {
      setWeek(null)
      setSessions([])
    }
  }

  async function openDetail(id: number) {
    if (isOffline) {
      toast("Chi tiết phiếu cần kết nối mạng")
      return
    }

    setDetailId(id)
    setDetail(null)
    try {
      const res = await api.get(`/duty/bancansu/session/${id}`)
      setDetail(res.data)
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.error || "Không thể tải chi tiết phiếu"
      toast.error(msg)
    }
  }

  function formatDateVN(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  function weekday(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-").map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    return dt.toLocaleDateString("vi-VN", { weekday: "short" })
  }

  const signedCount = useMemo(() => {
    return sessions.filter((s) => s.status === "signed").length
  }, [sessions])

  const weekScoreStats = useMemo(() => {
    const mine = summary?.my_summary
    return {
      plus: Number(mine?.plus_points || 0),
      minus: Number(mine?.minus_points || 0),
      total: Number(mine?.total_score ?? mine?.score ?? 0),
    }
  }, [summary])

  const periodLabel = weekId ? "tuần" : monthKey ? "tháng" : semesterKey ? "học kỳ" : "năm học"
  const summaryTitle = `Tổng kết ${periodLabel}`

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-5 pb-10 space-y-5">
        <div className="rounded-3xl bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-lg">
          <div className="px-6 pt-6 pb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm opacity-90">Xin chào</div>
              <button
                onClick={() => setShowChangePassword?.(true)}
                className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold hover:bg-white/30 transition"
              >
                Cài đặt
              </button>
            </div>

            <div className="mt-1 text-2xl font-semibold tracking-tight">
              Lớp {user?.class_name || "--"}
            </div>

            <div className="mt-4 flex items-baseline justify-between">
              <div className="text-3xl font-semibold tracking-tight">{time}</div>
              <div className="text-sm opacity-90">{todayDate}</div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-xs opacity-80">Điểm cộng</div>
                <div className="mt-0.5 text-base font-semibold">
                  {weekScoreStats.plus > 0 ? `+${weekScoreStats.plus}` : String(weekScoreStats.plus)}
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-xs opacity-80">Điểm trừ</div>
                <div className="mt-0.5 text-base font-semibold">
                  {weekScoreStats.minus > 0 ? `-${weekScoreStats.minus}` : "0"}
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-xs opacity-80">Tổng điểm {periodLabel}</div>
                <div className="mt-0.5 text-base font-semibold">
                  {weekScoreStats.total > 0 ? `+${weekScoreStats.total}` : String(weekScoreStats.total)}
                </div>
              </div>
            </div>

            {weekId ? (
              <div className="mt-3 text-[11px] opacity-80">
                Phiếu đã ký: {signedCount}/{sessions.length}
              </div>
            ) : null}
          </div>
        </div>

        <DutyPeriodSelector
          tree={periodTree}
          semesterKey={semesterKey}
          monthKey={monthKey}
          weekId={weekId}
          onSemesterChange={handleSemesterChange}
          onMonthChange={handleMonthChange}
          onWeekChange={handleWeekChange}
          formatDate={formatDateVN}
        />

        {weekId ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold text-gray-900">Phiếu trong tuần</div>
              <div className="ml-auto text-xs text-gray-500">{sessions.length} phiếu</div>
            </div>

            {loading ? (
              <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
            ) : sessions.length === 0 ? (
              <div className="mt-3 text-sm text-gray-600">
                Chưa có lớp nào trực lớp bạn trong tuần hiện tại.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openDetail(s.id)}
                    className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-left shadow-sm hover:bg-slate-50 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">
                          {weekday(s.date)} {formatDateVN(s.date)}: {s.red_class} trực
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          Tổng điểm:{" "}
                          <span
                            className={`font-semibold ${Number(s.total_score) >= 0 ? "text-emerald-700" : "text-red-600"}`}
                          >
                            {Number(s.total_score) > 0 ? `+${s.total_score}` : String(s.total_score)}
                          </span>{" "}
                          | Vi phạm:{" "}
                          <span className="font-semibold text-gray-700">
                            {Number(s.violation_score) > 0 ? `+${s.violation_score}` : String(s.violation_score)}
                          </span>{" "}
                          | Điểm cộng:{" "}
                          <span className="font-semibold text-[#2e77df]">
                            +{s.bonus_points || 0}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {s.status === "signed" ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            Đã ký
                          </span>
                        ) : (
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                            Nháp
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <DutyPeriodSummaryCard
          title={summaryTitle}
          summary={summary}
          loading={summaryLoading}
          className={user?.class_name}
        />
      </div>

      <Footer />

      {detailId != null && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setDetailId(null)
              setDetail(null)
            }}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="text-base font-semibold text-gray-900">Chi tiết phiếu</div>
              <button
                className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                onClick={() => {
                  setDetailId(null)
                  setDetail(null)
                }}
              >
                Đóng
              </button>
            </div>

            {!detail ? (
              <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
            ) : (
              <div className="mt-3 max-h-[70vh] overflow-y-auto space-y-4 pb-2">
                {(() => {
                  const vio = (detail.violations || []).reduce(
                    (sum: number, v: any) => sum + Number(v.score_delta || 0) * Number(v.quantity || 0),
                    0,
                  )
                  const bonus = Number(detail.session?.bonus_points || 0)
                  const total = vio + bonus
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-[11px] text-gray-500">Vi phạm</div>
                        <div className="mt-0.5 text-sm font-semibold text-gray-900">
                          {vio > 0 ? `+${vio}` : String(vio)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-[11px] text-gray-500">Cộng sổ đầu bài</div>
                        <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">
                          +{bonus}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-[11px] text-gray-500">Tổng điểm</div>
                        <div
                          className={`mt-0.5 text-sm font-semibold ${total >= 0 ? "text-emerald-700" : "text-red-600"}`}
                        >
                          {total > 0 ? `+${total}` : String(total)}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">
                    {weekday(detail.session.date)} {formatDateVN(detail.session.date)}: {detail.session.red_class} trực lớp bạn
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Trạng thái: {formatDutyStatus(detail.session.status)}
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
                  {detail.session.signature_photo_path ? (
                    <img src={detail.session.signature_photo_path} className="w-full" />
                  ) : (
                    <div className="h-40 flex items-center justify-center text-sm text-gray-500">
                      Chưa có ảnh ký
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-900">Vi phạm</div>
                  {(detail.violations || []).length === 0 ? (
                    <div className="text-sm text-gray-600">Không có vi phạm.</div>
                  ) : (
                    (detail.violations || []).map((v: any) => (
                      <div key={v.id} className="rounded-2xl border border-blue-100 bg-white px-4 py-3">
                        <div className="text-[15px] font-semibold text-gray-900">{v.name}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {v.category} | x{v.quantity} ({v.score_delta})
                        </div>
                        {v.note ? (
                          <div className="mt-1 text-xs text-gray-600">Ghi chú: {v.note}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
