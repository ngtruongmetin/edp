import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useOutletContext } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import AbsenceEvidencePanel from "../../components/AbsenceEvidencePanel"
import DutyPeriodSelector, { type DutyPeriodTree } from "../../components/DutyPeriodSelector"
import DutyPeriodSummaryCard, { type DutyPeriodSummary } from "../../components/DutyPeriodSummaryCard"
import GvcnWeeklyAiReportModal from "../../components/gvcn/GvcnWeeklyAiReportModal"
import { GVCN_WEEKLY_SUMMARY_TASK, requestGvcnAiReport, type GvcnAiReport } from "../../services/gvcnAiAssistant"
import { formatDutyStatus } from "../../utils/dutyFormat"
import { effectiveViolationScore, violationQuantityLabel } from "../../utils/dutyViolations"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { buildDashboardCacheKey, getCachedDashboard, setCachedDashboard } from "../../utils/offlineCache"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
  closed_at?: string | null
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

type FabPosition = {
  x: number
  y: number
}

const FAB_SIZE = 64
const FAB_MARGIN = 16
const FAB_STORAGE_KEY = "edp:gvcn-ai-fab-position:v1"

function AssistantIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" />
      <path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" />
    </svg>
  )
}

function clampFabPosition(position: FabPosition): FabPosition {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const topInset = width <= 768 ? 88 : 24
  const bottomInset = width <= 768 ? 112 : 24
  const minX = FAB_MARGIN
  const maxX = Math.max(FAB_MARGIN, width - FAB_SIZE - FAB_MARGIN)
  const minY = topInset
  const maxY = Math.max(topInset, height - FAB_SIZE - bottomInset)

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  }
}

function getDefaultFabPosition(): FabPosition {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight

  return clampFabPosition({
    x: width - FAB_SIZE - FAB_MARGIN,
    y: height * 0.45,
  })
}

function GvcnFloatingAssistantFab({ onOpen, disabled }: { onOpen: () => void; disabled: boolean }) {
  const [position, setPosition] = useState<FabPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    moved: false,
  })
  const frameRef = useRef<number | null>(null)
  const pendingPositionRef = useRef<FabPosition | null>(null)

  useEffect(() => {
    let nextPosition = getDefaultFabPosition()
    try {
      const saved = window.localStorage.getItem(FAB_STORAGE_KEY)
      if (saved) nextPosition = clampFabPosition(JSON.parse(saved) as FabPosition)
    } catch (err) {
      console.error(err)
    }
    setPosition(nextPosition)
  }, [])

  useEffect(() => {
    const handleViewportChange = () => {
      setPosition((current) => {
        const next = clampFabPosition(current ?? getDefaultFabPosition())
        window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
        return next
      })
    }

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("orientationchange", handleViewportChange)
    window.visualViewport?.addEventListener("resize", handleViewportChange)
    window.visualViewport?.addEventListener("scroll", handleViewportChange)
    return () => {
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("orientationchange", handleViewportChange)
      window.visualViewport?.removeEventListener("resize", handleViewportChange)
      window.visualViewport?.removeEventListener("scroll", handleViewportChange)
    }
  }, [])

  useEffect(() => () => {
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  if (!position) return null

  const schedulePosition = (next: FabPosition) => {
    pendingPositionRef.current = next
    if (frameRef.current != null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      if (pendingPositionRef.current) setPosition(pendingPositionRef.current)
    })
  }

  const commitPosition = (next: FabPosition) => {
    setPosition(next)
    window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.pointerId !== event.pointerId) return
    const deltaX = event.clientX - dragStateRef.current.startX
    const deltaY = event.clientY - dragStateRef.current.startY
    if (!dragStateRef.current.moved && Math.hypot(deltaX, deltaY) > 6) dragStateRef.current.moved = true
    schedulePosition(clampFabPosition({
      x: event.clientX - dragStateRef.current.offsetX,
      y: event.clientY - dragStateRef.current.offsetY,
    }))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    const current = pendingPositionRef.current ?? position
    const viewport = window.visualViewport
    const width = viewport?.width ?? window.innerWidth
    const snapped = clampFabPosition({
      x: current.x + FAB_SIZE / 2 < width / 2 ? FAB_MARGIN : width - FAB_SIZE - FAB_MARGIN,
      y: current.y,
    })
    const wasDragged = dragStateRef.current.moved
    dragStateRef.current.pointerId = -1
    pendingPositionRef.current = null
    commitPosition(snapped)
    setIsDragging(false)

    if (!wasDragged) onOpen()
  }

  const handlePointerCancel = () => {
    dragStateRef.current.pointerId = -1
    pendingPositionRef.current = null
    setIsDragging(false)
    setPosition((current) => {
      const next = clampFabPosition(current ?? getDefaultFabPosition())
      window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      disabled={disabled}
      className={`fixed z-40 flex h-16 w-16 items-center justify-center rounded-full border border-white/45 bg-white/24 text-[#2e77df] backdrop-blur-2xl shadow-[0_18px_45px_rgba(46,119,223,0.22),inset_0_1px_0_rgba(255,255,255,0.65)] transition-[transform,left,top,box-shadow] duration-300 ease-out ${
        isDragging
          ? "scale-110 shadow-[0_28px_56px_rgba(46,119,223,0.28),inset_0_1px_0_rgba(255,255,255,0.72)]"
          : "active:scale-[0.97]"
      } disabled:cursor-not-allowed disabled:opacity-55`}
      style={{ left: position.x, top: position.y, touchAction: "none" }}
      aria-label="Mở phân tích nề nếp bằng AI"
    >
      <div className="absolute inset-[4px] rounded-full bg-gradient-to-br from-white/48 via-white/10 to-[#2e77df]/14" />
      <div className="relative flex flex-col items-center gap-0.5">
        <AssistantIcon />
        <span className="text-[11px] font-semibold leading-none">AI</span>
      </div>
    </button>
  )
}

export default function GvcnDashboard() {
  usePageTitle("EDP | Giáo viên chủ nhiệm")
  const { user: authUser, isOffline } = useAuth()
  const context = useOutletContext<any>()
  const user = context?.user
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
  const [aiReport, setAiReport] = useState<GvcnAiReport | null>(null)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRegenerating, setAiRegenerating] = useState(false)
  const [aiError, setAiError] = useState("")

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
          setSummaryLoading(false)
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
          setSummaryLoading(false)
        }
      }
    }

    void loadCachedSnapshot()
  }, [authUser, isOffline])

  useEffect(() => {
    if (user?.class_name && !isOffline) {
      loadWeeks()
    }
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
      const res = await api.get("/duty/gvcn/period-tree")
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
      const res = await api.get(`/duty/gvcn/week/${id}`)
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
      const msg = err?.response?.data?.error || "Không thể tải danh sách phiếu"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function loadWeekSummary(id: number) {
    try {
      setSummaryLoading(true)
      const res = await api.get(`/duty/gvcn/week/${id}/summary`)
      setSummary(res.data)
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.error || "Không thể tải xếp hạng tuần"
      toast.error(msg)
    } finally {
      setSummaryLoading(false)
    }
  }

  async function loadPeriodSummary(type: "month" | "semester" | "year", key: string) {
    try {
      setSummaryLoading(true)
      const res = await api.get(`/duty/gvcn/${type}/${encodeURIComponent(key)}/summary`)
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
    setAiDialogOpen(false)
    setAiReport(null)
    setAiError("")
  }

  function handleMonthChange(value: string) {
    setMonthKey(value)
    setWeekId(null)
    setWeek(null)
    setSessions([])
    setAiDialogOpen(false)
    setAiReport(null)
    setAiError("")
  }

  function handleWeekChange(value: number | null) {
    setWeekId(value)
    if (!value) {
      setWeek(null)
      setSessions([])
    }
    setAiDialogOpen(false)
    setAiReport(null)
    setAiError("")
  }

  async function requestAiReport(force = false) {
    if (!weekId) return
    if (isOffline) {
      toast("Phân tích AI cần kết nối mạng")
      return
    }

    setAiError("")
    if (force) setAiRegenerating(true)
    else setAiLoading(true)

    try {
      const report = await requestGvcnAiReport({
        task: GVCN_WEEKLY_SUMMARY_TASK,
        weekId,
        classId: authUser?.class_id,
        force,
      })
      setAiReport(report)
    } catch (err) {
      console.error(err)
      setAiError(getApiErrorMessage(err, "Không thể phân tích dữ liệu nề nếp"))
    } finally {
      if (force) setAiRegenerating(false)
      else setAiLoading(false)
    }
  }

  function openAiReport() {
    if (!weekId) return
    setAiDialogOpen(true)
    void requestAiReport()
  }

  async function openDetail(id: number) {
    if (isOffline) {
      toast("Chi tiết phiếu cần kết nối mạng")
      return
    }

    setDetailId(id)
    setDetail(null)
    try {
      const res = await api.get(`/duty/gvcn/session/${id}`)
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
            <div className="flex items-center gap-3">
              <div className="text-sm opacity-90">Xin chào thầy/cô</div>
            </div>

            <div className="mt-1 text-2xl font-semibold tracking-tight">
              Lớp {user?.class_name || "--"}
            </div>

            <div className="mt-4 flex items-baseline justify-between">
              <div className="text-3xl font-semibold tracking-tight">{time}</div>
              <div className="text-sm opacity-90">{todayDate}</div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <div className="text-xs opacity-80">Điểm cộng</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {weekScoreStats.plus > 0 ? `+${weekScoreStats.plus}` : String(weekScoreStats.plus)}
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <div className="text-xs opacity-80">Điểm trừ</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {weekScoreStats.minus > 0 ? `-${weekScoreStats.minus}` : "0"}
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <div className="text-xs opacity-80">Tổng điểm {periodLabel}</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {weekScoreStats.total > 0 ? `+${weekScoreStats.total}` : String(weekScoreStats.total)}
                </div>
              </div>
            </div>
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

        <AbsenceEvidencePanel week={week} disabled={isOffline} />

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
                Chưa có phiếu trực cho lớp thầy/cô trong tuần này.
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
                            className={`font-semibold ${
                              Number(s.total_score) >= 0 ? "text-emerald-700" : "text-red-600"
                            }`}
                          >
                            {Number(s.total_score) > 0 ? `+${s.total_score}` : String(s.total_score)}
                          </span>{" "}
                          | Vi phạm:{" "}
                          <span className="font-semibold text-gray-700">
                            {Number(s.violation_score) > 0
                              ? `+${s.violation_score}`
                              : String(s.violation_score)}
                          </span>{" "}
                          | Điểm cộng:{" "}
                          <span className="font-semibold text-[#2e77df]">+{s.bonus_points || 0}</span>
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

      {weekId ? (
        <GvcnFloatingAssistantFab
          onOpen={openAiReport}
          disabled={aiLoading || aiRegenerating || isOffline}
        />
      ) : null}

      <Footer />

      <GvcnWeeklyAiReportModal
        open={aiDialogOpen}
        report={aiReport}
        loading={aiLoading}
        regenerating={aiRegenerating}
        error={aiError}
        weekNumber={week?.week_number ?? weeks.find((item) => item.id === weekId)?.week_number ?? null}
        onClose={() => setAiDialogOpen(false)}
        onRegenerate={() => void requestAiReport(true)}
      />

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
                    (sum: number, v: any) => sum + effectiveViolationScore(v),
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
                        <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">+{bonus}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-[11px] text-gray-500">Tổng điểm</div>
                        <div
                          className={`mt-0.5 text-sm font-semibold ${
                            total >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {total > 0 ? `+${total}` : String(total)}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">
                    {weekday(detail.session.date)} {formatDateVN(detail.session.date)}: {detail.session.red_class} trực lớp thầy/cô
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
                          {v.category} | {violationQuantityLabel(v)} ({v.score_delta})
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
