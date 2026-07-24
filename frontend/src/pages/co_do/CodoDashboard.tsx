import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import toast from "react-hot-toast"
import { formatDutyStatus } from "../../utils/dutyFormat"
import { buildDashboardCacheKey, getCachedDashboard, setCachedDashboard } from "../../utils/offlineCache"
import { usePageTitle } from "../../utils/usePageTitle"

type Assignment = {
  red_class: string
  duty_class: string
}

type Week = {
  id?: number
  week_number: number
  start_date: string
  end_date: string
}

type ScheduleRes = {
  week: Week
  assignments: Assignment[]
}

type DashboardSnapshot = {
  className: string
  dutyClassCurrent: string | null
  dutyClassView: string | null
  weeks: Week[]
  weekId: number | null
  prevWeekId: number | null
  week: Week | null
  myWeekSessions: any[]
}

export default function CoDoDashboard() {
  usePageTitle("EDP | Cờ đỏ")
  const { user: authUser, isOffline } = useAuth()

  const [time, setTime] = useState("")
  const [date, setDate] = useState("")

  const [className, setClassName] = useState("")
  const [dutyClassCurrent, setDutyClassCurrent] = useState<string | null>(null)
  const [dutyClassView, setDutyClassView] = useState<string | null>(null)

  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [prevWeekId, setPrevWeekId] = useState<number | null>(null)
  const [week, setWeek] = useState<Week | null>(null)
  const [myWeekSessions, setMyWeekSessions] = useState<any[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<any>(null)

  const navigate = useNavigate()
  const dashboardReady = !!className && (week !== null || weeks.length > 0)

  useEffect(() => {
    async function loadCachedSnapshot() {
      try {
        const cacheKey = buildDashboardCacheKey(authUser)
        const cached = await getCachedDashboard<DashboardSnapshot>(cacheKey)

        if (!cached) return

        setClassName(cached.className || "")
        setDutyClassCurrent(cached.dutyClassCurrent || null)
        setDutyClassView(cached.dutyClassView || null)
        setWeeks(cached.weeks || [])
        setWeekId(cached.weekId ?? null)
        setPrevWeekId(cached.prevWeekId ?? null)
        setWeek(cached.week || null)
        setMyWeekSessions(cached.myWeekSessions || [])
      } catch (err) {
        console.error(err)
      }
    }

    void loadCachedSnapshot()
  }, [authUser])

  useEffect(() => {
    setClassName(authUser?.class_name || "")
  }, [authUser?.class_name])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()

      const h = String(now.getHours()).padStart(2, "0")
      const m = String(now.getMinutes()).padStart(2, "0")
      const s = String(now.getSeconds()).padStart(2, "0")

      const d = String(now.getDate()).padStart(2, "0")
      const mo = String(now.getMonth() + 1).padStart(2, "0")
      const y = now.getFullYear()

      setTime(`${h}:${m}:${s}`)
      setDate(`${d}/${mo}/${y}`)
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!className || isOffline) return
    loadSchedule()
    loadWeeks()
  }, [className, isOffline])

  useEffect(() => {
    if (!weekId || isOffline) return
    loadMyWeek(weekId)
  }, [weekId, isOffline])

  useEffect(() => {
    if (
      !className &&
      !dutyClassCurrent &&
      !dutyClassView &&
      !weeks.length &&
      !week &&
      !myWeekSessions.length
    ) {
      return
    }

    const cacheKey = buildDashboardCacheKey(authUser)

    void setCachedDashboard(cacheKey, {
      className,
      dutyClassCurrent,
      dutyClassView,
      weeks,
      weekId,
      prevWeekId,
      week,
      myWeekSessions,
    })
  }, [authUser, className, dutyClassCurrent, dutyClassView, weeks, weekId, prevWeekId, week, myWeekSessions])

  async function loadSchedule() {
    try {
      const res = await api.get("/schedule")

      const data: ScheduleRes = res.data

      setWeek(data.week)

      const row = data.assignments.find(
        (a) => a.red_class === className,
      )

      if (row) {
        setDutyClassCurrent(row.duty_class)
      } else {
        setDutyClassCurrent(null)
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function loadWeeks() {
    try {
      const res = await api.get("/duty/co_do/weeks")
      const list: Week[] = res.data.weeks || []
      setWeeks(list)

      const latest = list[0] || null
      const previous = list[1] || null

      setPrevWeekId(previous?.id ?? null)
      setWeekId(latest?.id ?? null)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadMyWeek(id: number) {
    try {
      const res = await api.get(`/duty/co_do/week/${id}`)
      setWeek(res.data.week || null)
      setMyWeekSessions(res.data.sessions || [])

      setDutyClassView(res.data.duty_class || null)
    } catch (err) {
      console.error(err)
    }
  }

  async function startDutyNow() {
    if (isOffline) {
      toast("Chức năng này cần kết nối mạng")
      return
    }

    try {
      const res = await api.post("/duty/create", {})
      const sessionId = Number(res.data?.session_id || 0)

      if (!sessionId) {
        toast.error("Không thể mở phiếu trực")
        return
      }

      navigate(`/co_do/duty/${sessionId}`)
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.error || "Không thể bắt đầu ca trực"
      toast.error(msg)
    }
  }

  function weekday(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-").map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    return dt.toLocaleDateString("vi-VN", { weekday: "short" })
  }

  function weekLabelById(id: number | null) {
    if (!id) return "Tuần ?"
    const found = weeks.find((w) => Number(w.id) === Number(id))
    return found?.week_number ? `Tuần ${found.week_number}` : "Tuần ?"
  }

  const latestWeek = weeks[0] || null

  async function openDetail(id: number) {
    if (isOffline) {
      toast("Chi tiết phiếu cần kết nối mạng")
      return
    }

    setDetailId(id)
    setDetail(null)
    try {
      const res = await api.get(`/duty/my/session/${id}`)
      setDetail(res.data)
    } catch (err) {
      console.error(err)
      toast.error("Không tải được phiếu")
    }
  }

  function editSession(id: number) {
    if (isOffline) {
      toast("Chức năng chỉnh sửa cần kết nối mạng")
      return
    }

    navigate(`/co_do/duty/${id}`)
  }

  function formatDate(date: string) {
    if (!date) return ""

    const [y, m, d] = date.split("-")

    return `${d}/${m}/${y}`
  }

  return (
    <div className="edp-mobile-shell flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-4 pb-28 space-y-4">
        <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-[0_18px_42px_rgba(30,64,175,0.28)]">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
                  Xin chào
                </div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  Cờ đỏ lớp {className || "--"}
                </div>
              </div>
            </div>

            {dashboardReady ? (
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-4xl font-semibold tracking-tight tabular-nums">
                    {time}
                  </div>
                  <div className="mt-1 text-sm opacity-85">
                    {date}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/12 px-4 py-3 text-right">
                  <div className="text-[11px] uppercase tracking-[0.12em] opacity-75">
                    Phiếu tuần
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {latestWeek ? `Tuần ${latestWeek.week_number}` : "Đang tải"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                <div className="h-12 w-36 rounded-2xl bg-white/15 animate-pulse" />
                <div className="h-4 w-28 rounded-full bg-white/15 animate-pulse" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-sm text-gray-600">Chọn tuần</div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => latestWeek?.id && setWeekId(latestWeek.id)}
              className={`min-h-12 shrink-0 rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.98] ${
                weekId === latestWeek?.id
                  ? "bg-[#2e77df] text-white"
                  : "bg-white text-gray-900 ring-1 ring-blue-50 hover:bg-gray-50"
              }`}
            >
              {latestWeek ? `Tuần ${latestWeek.week_number}` : "Tuần ?"}
            </button>
            {prevWeekId && (
              <button
                onClick={() => setWeekId(prevWeekId)}
                className={`min-h-12 shrink-0 rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.98] ${
                  weekId === prevWeekId
                    ? "bg-[#2e77df] text-white"
                    : "bg-white text-gray-900 ring-1 ring-blue-50 hover:bg-gray-50"
                }`}
              >
                {weekLabelById(prevWeekId)}
              </button>
            )}
          </div>
          {week ? (
            <>
              <div className="mt-4 text-xl font-semibold text-[#2e77df]">
                Tuần {week.week_number}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                {formatDate(week.start_date)} - {formatDate(week.end_date)}
              </div>
            </>
          ) : !dashboardReady ? (
            <div className="mt-4 space-y-2">
              <div className="h-5 w-32 rounded-full bg-slate-100 animate-pulse" />
              <div className="h-4 w-48 rounded-full bg-slate-100 animate-pulse" />
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Chưa có dữ liệu tuần.</div>
          )}
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-sm text-gray-600">
            Lớp trực
          </div>

          <div className="mt-1 text-3xl font-semibold text-[#2e77df]">
            {dutyClassView ? dutyClassView : "--"}
          </div>

          {!dutyClassView && (
            <div className="mt-2 text-xs text-gray-500">
              Chưa có lịch trực cho lớp bạn trong tuần đang xem.
            </div>
          )}
        </div>

        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30">
          <button
            onClick={startDutyNow}
            disabled={!dutyClassCurrent || isOffline}
            className="block w-full min-h-14 rounded-[20px] bg-[#2e77df] px-4 py-4 text-center text-[15px] font-semibold text-white shadow-[0_12px_28px_rgba(46,119,223,0.24)] transition hover:bg-[#1f5fc0] active:scale-[0.98] disabled:opacity-50"
          >
            Bắt đầu trực
          </button>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-gray-900">
              Phiếu trực trong tuần
            </div>
            <div className="ml-auto text-xs text-gray-500">
              {myWeekSessions.length} phiếu
            </div>
          </div>

          {myWeekSessions.length === 0 ? (
            <div className="mt-3 text-sm text-gray-600">
              Chưa có phiếu trực trong tuần đang xem.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {myWeekSessions.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => openDetail(s.id)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-gray-900">
                        {weekday(s.date)} {formatDate(s.date)}: trực {s.duty_class}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        Tổng điểm:{" "}
                        <span
                          className={`font-semibold ${
                            Number(s.total_score) >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {Number(s.total_score) > 0
                            ? `+${s.total_score}`
                            : String(s.total_score)}
                        </span>{" "}
                        | Vi phạm:{" "}
                        <span className="font-semibold text-gray-700">
                          {Number(s.violation_score) > 0
                            ? `+${s.violation_score}`
                            : String(s.violation_score)}
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
                <div className="text-base font-semibold text-gray-900">
                  Phiếu trực
                </div>
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
                      {weekday(detail.session.date)} {formatDate(detail.session.date)}: Cờ đỏ {detail.session.red_class} trực {detail.session.duty_class}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Trạng thái: {formatDutyStatus(detail.session.status)}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => editSession(detail.session.id)}
                        className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
                      >
                        Chỉnh sửa / Ký lại
                      </button>
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
                    {detail.violations.length === 0 ? (
                      <div className="text-sm text-gray-600">Không có vi phạm.</div>
                    ) : (
                      detail.violations.map((v: any) => (
                        <div key={v.id} className="rounded-2xl border border-blue-100 bg-white px-4 py-3">
                          <div className="text-[15px] font-semibold text-gray-900">{v.name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{v.category} | x{v.quantity} ({v.score_delta})</div>
                          {v.note ? <div className="mt-1 text-xs text-gray-600">Ghi chú: {v.note}</div> : null}
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

      <Footer />
    </div>
  )
}
