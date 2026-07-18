import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { localISODate } from "../../utils/dateLocal"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

export default function AdminWeeklySummary() {
  usePageTitle("EDP | Tổng kết tuần")
  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [detailClass, setDetailClass] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)

  const today = useMemo(() => localISODate(new Date()), [])

  useEffect(() => {
    boot()
  }, [])

  async function boot() {
    setLoading(true)
    try {
      const res = await api.get("/schedule/admin")
      const list: Week[] = res.data || []
      setWeeks(list)
      const current = list.find((x) => x.start_date <= today && x.end_date >= today)
      const id = current?.id ?? (list.length ? list[0].id : null)
      setWeekId(id)
      if (id) await load(id)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách tuần"))
    } finally {
      setLoading(false)
    }
  }

  async function load(id: number) {
    setLoading(true)
    try {
      const res = await api.get(`/duty/admin/week/${id}/summary`)
      setSummary(res.data)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được tổng kết tuần"))
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!weekId) return
    try {
      const res = await api.get(`/duty/admin/week/${weekId}/export`, {
        responseType: "blob",
      })
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ket_qua_thi_dua_tuan_${summary?.week?.week_number || weekId}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được file Excel"))
    }
  }

  async function openDetail(className: string) {
    if (!weekId) return
    setDetailClass(className)
    setDetail(null)
    try {
      const res = await api.get(
        `/duty/admin/week/${weekId}/class/${encodeURIComponent(className)}/breakdown`,
      )
      setDetail(res.data)
    } catch (err) {
      setDetailClass(null)
      toast.error(getApiErrorMessage(err, "Không tải được chi tiết lớp"))
    }
  }

  async function closeWeek() {
    if (!weekId) return
    try {
      const stats = await api.get(`/duty/admin/week/${weekId}/stats`)
      const drafts = Number(stats.data.draft_count || 0)
      const msg =
        drafts > 0
          ? `Tuần này còn ${drafts} phiếu chưa ký. Phiếu nháp sẽ không được tính. Vẫn tổng kết và khóa tuần?`
          : "Tổng kết tuần này và khóa chỉnh sửa?"
      if (!confirm(msg)) return
      await api.post(`/duty/admin/week/${weekId}/close`)
      toast.success("Đã tổng kết tuần")
      await load(weekId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tổng kết tuần"))
    }
  }

  async function reopenWeek() {
    if (!weekId) return
    if (!confirm("Mở khóa tuần này (cho phép chỉnh sửa lại)?")) return
    try {
      await api.post(`/duty/admin/week/${weekId}/reopen`)
      toast.success("Đã mở khóa tuần")
      await load(weekId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể mở khóa tuần"))
    }
  }

  function formatDateISO(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  function formatDDMM(dateStr: string) {
    if (!dateStr) return ""
    const [, m, d] = dateStr.split("-")
    return `${d}/${m}`
  }

  function parseClassName(name: string) {
    const g = parseInt(name, 10) || 0
    const aPos = name.indexOf("A")
    const num = aPos >= 0 ? parseInt(name.slice(aPos + 1), 10) || 0 : 0
    return { g, num, name }
  }

  const groupedScores = useMemo(() => {
    const rows = (summary?.scores || []) as any[]
    const byGrade: Record<string, any[]> = { "10": [], "11": [], "12": [] }
    rows.forEach((r) => {
      const grade = String(parseInt(String(r.class_name || ""), 10) || "")
      if (grade === "10" || grade === "11" || grade === "12") byGrade[grade].push(r)
    })

    ;(["10", "11", "12"] as const).forEach((g) => {
      byGrade[g].sort((a, b) => {
        const ds = Number(b.score) - Number(a.score)
        if (ds !== 0) return ds
        const aa = parseClassName(String(a.class_name || ""))
        const bb = parseClassName(String(b.class_name || ""))
        if (aa.num !== bb.num) return aa.num - bb.num
        return aa.name.localeCompare(bb.name)
      })

      // Competition ranking (1,2,2,4...) within each grade.
      let prevScore: number | null = null
      let prevRank = 0
      byGrade[g].forEach((r, idx) => {
        const s = Number(r.score)
        if (prevScore != null && s === prevScore) r.rank = prevRank
        else r.rank = idx + 1
        prevScore = s
        prevRank = r.rank
      })
    })

    return byGrade
  }, [summary])

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Tổng kết tuần</span>
        </div>

        <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Bảng xếp hạng</div>
              <div className="mt-1 text-sm text-gray-600">
                Tổng điểm theo lớp (tuần)
              </div>
            </div>

            <div className="sm:ml-auto flex items-center gap-3">
              <select
                value={weekId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  setWeekId(id)
                  load(id)
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    Tuần {w.week_number} ({formatDateISO(w.start_date)} - {formatDateISO(w.end_date)})
                  </option>
                ))}
              </select>
              <button
                onClick={closeWeek}
                disabled={!!summary?.closed_at || !weekId}
                className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
              >
                Tổng kết tuần
              </button>

              <button
                onClick={reopenWeek}
                disabled={!summary?.closed_at || !weekId}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
              >
                Mở khóa tuần
              </button>

              <button
                onClick={exportExcel}
                disabled={!weekId}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
              >
                Xuất Excel
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
            <div className="text-sm text-gray-600">Đang tải dữ liệu...</div>
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
              <div className="text-sm text-gray-600">
                {summary.closed_at ? `Đã tổng kết: ${summary.closed_at}` : "Chưa tổng kết"}
              </div>
            </div>

            {(["10", "11", "12"] as const).map((g) => (
              <div
                key={g}
                className="edp-glass-panel rounded-[32px] p-0 overflow-hidden"
              >
                <div className="px-5 py-4 flex items-center">
                  <div className="text-sm font-semibold text-gray-900">Khối {g}</div>
                  <div className="ml-auto text-xs text-gray-500">
                    {groupedScores[g].length} lớp
                  </div>
                </div>
                <div className="divide-y divide-blue-50">
                  {groupedScores[g].map((r: any, idx: number) => (
                    <button
                      key={r.class_name}
                      onClick={() => openDetail(r.class_name)}
                      className="w-full px-5 py-4 flex items-center text-left hover:bg-slate-50 transition"
                    >
                      <div className="w-10 text-sm font-semibold text-gray-500">
                        #{r.rank ?? idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">
                          {r.class_name}
                        </div>
                      </div>
                      <div
                        className={`text-lg font-semibold ${
                          Number(r.score) >= 0 ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        {String(r.score)}
                      </div>
                    </button>
                  ))}
                  {groupedScores[g].length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-600">
                      Chưa có dữ liệu cho khối {g}.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {detailClass && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                setDetailClass(null)
                setDetail(null)
              }}
            />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl md:left-1/2 md:top-1/2 md:bottom-auto md:inset-x-auto md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-xl md:rounded-3xl">
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold text-gray-900">
                  Chi tiết điểm: {detailClass}
                </div>
                <button
                  className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                  onClick={() => {
                    setDetailClass(null)
                    setDetail(null)
                  }}
                >
                  Đóng
                </button>
              </div>

              {!detail ? (
                <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                      <div className="text-[11px] text-gray-500">Điểm cộng</div>
                      <div className="mt-0.5 text-lg font-semibold text-[#2e77df]">
                        {Number(detail.breakdown?.plus_points || 0)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                      <div className="text-[11px] text-gray-500">Điểm trừ</div>
                      <div className="mt-0.5 text-lg font-semibold text-red-600">
                        {Number(detail.breakdown?.minus_points || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                    <div className="text-[11px] text-gray-500">Tổng điểm</div>
                    <div
                      className={`mt-0.5 text-2xl font-semibold ${
                        Number(detail.breakdown?.total_score || 0) >= 0
                          ? "text-emerald-700"
                          : "text-red-600"
                      }`}
                    >
                      {Number(detail.breakdown?.total_score || 0)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                    <div className="text-sm font-semibold text-gray-900">Chi tiết theo ngày</div>
                    <div className="mt-2 space-y-3">
                      {(detail.days || []).map((d: any) => {
                        const minus = (d.violations || []).reduce(
                          (s: number, v: any) =>
                            s + Number(v.score_delta || 0) * Number(v.quantity || 0),
                          0,
                        )
                        return (
                          <div key={d.date} className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-xs text-gray-600">
                            {formatDDMM(d.date)}: Cộng sổ đầu bài +{Number(d.bonus_points || 0)} •
                            Vi phạm {minus}
                          </div>
                        </div>
                        )
                      })}
                      {(!detail.days || detail.days.length === 0) && (
                        <div className="text-sm text-gray-600">Chưa có dữ liệu ngày.</div>
                      )}
                    </div>
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
