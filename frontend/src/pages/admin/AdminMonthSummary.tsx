import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import toast from "react-hot-toast"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

export default function AdminMonthSummary() {
  usePageTitle("EDP | Tổng kết tháng")
  const [weeks, setWeeks] = useState<Week[]>([])
  const [months, setMonths] = useState<any[]>([])
  const [selectedMonth, setSelectedMonth] = useState("")
  const [monthInput, setMonthInput] = useState("")
  const [monthKey, setMonthKey] = useState<string | null>(null)
  const [weekIds, setWeekIds] = useState<number[]>([])

  const [loading, setLoading] = useState(true)
  const [closedAt, setClosedAt] = useState<string | null>(null)
  const [scoresByGrade, setScoresByGrade] = useState<any>({ 10: [], 11: [], 12: [] })

  const [detailClass, setDetailClass] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [adjDelta, setAdjDelta] = useState("0")
  const [adjReason, setAdjReason] = useState("")
  const [savingAdj, setSavingAdj] = useState(false)
  const [uploadingMonthAdj, setUploadingMonthAdj] = useState(false)
  const monthAdjFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    boot()
  }, [])

  async function boot() {
    setLoading(true)
    try {
      const res = await api.get("/schedule/admin")
      setWeeks(res.data || [])
      const m = await api.get("/duty/admin/month/list")
      setMonths(m.data.months || [])
    } finally {
      setLoading(false)
    }
  }

  function formatDateISO(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  const weekOptions = useMemo(() => {
    return weeks.map((w) => ({
      id: w.id,
      label: `Tuần ${w.week_number} (${formatDateISO(w.start_date)} - ${formatDateISO(w.end_date)})`,
    }))
  }, [weeks])

  function toggleWeek(id: number) {
    setWeekIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function preview() {
    if (!monthInput.trim()) {
      toast.error("Nhập tháng (mm/yyyy)")
      return
    }
    setLoading(true)
    try {
      const payload: any = { month_key: monthInput.trim() }
      if (weekIds.length) payload.week_ids = weekIds
      const res = await api.post("/duty/admin/month/preview", payload)
      setMonthKey(res.data.month_key)
      setClosedAt(res.data.closed_at || null)
      setScoresByGrade(res.data.scores_by_grade || { 10: [], 11: [], 12: [] })
    } finally {
      setLoading(false)
    }
  }

  async function saveMonth() {
    if (!monthInput.trim()) {
      toast.error("Nhập tháng (mm/yyyy)")
      return
    }
    if (weekIds.length === 0) {
      toast.error("Chọn ít nhất 1 tuần")
      return
    }
    await api.post("/duty/admin/month/save", {
      month_key: monthInput.trim(),
      week_ids: weekIds,
    })
    toast.success("Đã lưu tháng")
    const m = await api.get("/duty/admin/month/list")
    setMonths(m.data.months || [])
  }

  async function closeMonth() {
    if (!monthInput.trim()) return
    if (!confirm("Tổng kết tháng và khóa chỉnh sửa?")) return
    const payload: any = { month_key: monthInput.trim() }
    if (weekIds.length) payload.week_ids = weekIds
    await api.post("/duty/admin/month/close", payload)
    await preview()
  }

  async function reopenMonth() {
    if (!monthInput.trim()) return
    if (!confirm("Mở khóa tháng này?")) return
    await api.post("/duty/admin/month/reopen", { month_key: monthInput.trim() })
    await preview()
  }

  async function exportExcel() {
    const key = monthKey || monthInput.trim()
    if (!key) return
    const res = await api.get(`/duty/admin/month/${encodeURIComponent(key)}/export`, {
      responseType: "blob",
    })
    const blob = new Blob([res.data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ket_qua_thi_dua_thang_${key}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function openDetail(className: string) {
    const key = monthKey || monthInput.trim()
    if (!key) return
    setDetailClass(className)
    setDetail(null)
    const res = await api.get(
      `/duty/admin/month/${encodeURIComponent(key)}/class/${encodeURIComponent(className)}/breakdown`,
    )
    setDetail(res.data)
    const delta =
      Number(res.data?.breakdown?.adjust_plus || 0) - Number(res.data?.breakdown?.adjust_minus || 0)
    setAdjDelta(String(delta))
    setAdjReason(String(res.data?.breakdown?.adjust_reason ?? ""))
  }

  async function saveAdjustment() {
    if (!detailClass) return
    const key = monthKey || monthInput.trim()
    if (!key) return
    setSavingAdj(true)
    try {
      const delta = Number(adjDelta || 0)
      await api.post("/duty/admin/month/adjustment", {
        month_key: key,
        class_name: detailClass,
        plus_points: delta > 0 ? delta : 0,
        minus_points: delta < 0 ? -delta : 0,
        reason: adjReason,
      })
      toast.success("Đã lưu")
      await preview()
      await openDetail(detailClass)
    } finally {
      setSavingAdj(false)
    }
  }

  async function uploadMonthAdjustmentFile(file: File) {
    const key = monthKey || monthInput.trim()
    if (!key) {
      toast.error("Nhập/chọn tháng trước")
      return
    }
    setUploadingMonthAdj(true)
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || ""))
        fr.onerror = () => reject(new Error("Không thể đọc file"))
        fr.readAsDataURL(file)
      })
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl
      const res = await api.post("/duty/admin/month/adjustment/upload", {
        month_key: key,
        file_name: file.name,
        file_data: base64,
      })
      toast.success(`Đã nhập ${Number(res.data?.imported || 0)} lớp`)
      await preview()
      if (detailClass) await openDetail(detailClass)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Không thể nhập file Excel"
      toast.error(msg)
    } finally {
      setUploadingMonthAdj(false)
      if (monthAdjFileRef.current) monthAdjFileRef.current.value = ""
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Tổng kết tháng</span>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Tổng kết tháng</div>
              <div className="mt-1 text-sm text-gray-600">
                Nhập tháng (mm/yyyy), chọn tuần, thêm điểm cộng trừ riêng theo tháng rồi khóa và xuất Excel.
              </div>
              {closedAt ? (
                <div className="mt-1 text-xs text-gray-500">Đã tổng kết: {closedAt}</div>
              ) : null}
            </div>

            <div className="lg:ml-auto grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
              <select
                value={selectedMonth}
                onChange={(e) => {
                  const key = e.target.value
                  setSelectedMonth(key)
                  const m = months.find((x: any) => x.month_key === key)
                  if (m) {
                    setMonthInput(m.month_key)
                    setWeekIds(m.week_ids || [])
                    setMonthKey(m.month_key)
                    setClosedAt(m.closed_at || null)
                  }
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Chọn tháng</option>
                {months.map((m: any) => (
                  <option key={m.month_key} value={m.month_key}>
                    Tháng {m.month_key}
                  </option>
                ))}
              </select>
              <input
                value={monthInput}
                onChange={(e) => setMonthInput(e.target.value)}
                placeholder="mm/yyyy"
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              />
              <button
                onClick={saveMonth}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
              >
                Lưu tháng
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={preview}
              className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Tải kết quả
            </button>
            <button
              onClick={() => monthAdjFileRef.current?.click()}
              disabled={!monthInput.trim() || !!closedAt || uploadingMonthAdj}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              {uploadingMonthAdj ? "Đang nhập..." : "Nhập Excel cộng/trừ"}
            </button>
            <button
              onClick={exportExcel}
              disabled={!monthInput.trim()}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Xuất Excel
            </button>
            <input
              ref={monthAdjFileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadMonthAdjustmentFile(file)
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Chọn tuần</div>
              <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
                {weekOptions.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-blue-50"
                  >
                    <input
                      type="checkbox"
                      checked={weekIds.includes(w.id)}
                      onChange={() => toggleWeek(w.id)}
                    />
                    <span className="text-sm text-gray-800">{w.label}</span>
                  </label>
                ))}
                {weekOptions.length === 0 ? (
                  <div className="text-sm text-gray-600">Chưa có tuần.</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 flex flex-wrap gap-3 items-center">
              <button
                onClick={closeMonth}
                disabled={!!closedAt || !monthInput.trim()}
                className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
              >
                Tổng kết & khóa
              </button>
              <button
                onClick={reopenMonth}
                disabled={!closedAt || !monthInput.trim()}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
              >
                Mở khóa
              </button>
              <div className="text-xs text-gray-600 ml-auto">
                {weekIds.length} tuần được chọn
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="text-sm text-gray-600">Đang tải dữ liệu...</div>
          </div>
        ) : (
          <div className="space-y-4">
            {([10, 11, 12] as const).map((g) => (
              <div
                key={g}
                className="rounded-3xl bg-white p-0 shadow-sm ring-1 ring-blue-50 overflow-hidden"
              >
                <div className="px-5 py-4 flex items-center">
                  <div className="text-sm font-semibold text-gray-900">Khối {g}</div>
                  <div className="ml-auto text-xs text-gray-500">
                    {(scoresByGrade?.[g] || []).length} lớp
                  </div>
                </div>
                <div className="divide-y divide-blue-50">
                  {(scoresByGrade?.[g] || []).map((r: any) => (
                    <button
                      key={r.class_name}
                      onClick={() => openDetail(r.class_name)}
                      className="w-full px-5 py-4 flex items-center text-left hover:bg-slate-50 transition"
                    >
                      <div className="w-10 text-sm font-semibold text-gray-500">
                        #{r.rank ?? "-"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">{r.class_name}</div>
                        {r.note ? (
                          <div className="text-xs font-semibold text-amber-700">{r.note}</div>
                        ) : null}
                      </div>
                      <div className="text-lg font-semibold text-gray-900">{r.total_score}</div>
                    </button>
                  ))}
                  {(scoresByGrade?.[g] || []).length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-600">
                      Chưa có dữ liệu.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

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
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                      <div className="text-[11px] text-gray-500">Tổng tuần</div>
                      <div className="mt-0.5 text-lg font-semibold text-gray-900">
                        {Number(detail.breakdown?.week_total || 0)}
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {(detail.week_details || []).map((w: any, idx: number) => (
                          <div key={`${w.week_id}-${idx}`} className="text-[11px] text-gray-500">
                            Tuần {w.week_number ?? "--"}: {Number(w.score || 0)} điểm
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                      <div className="text-[11px] text-gray-500">Cộng, trừ tháng</div>
                      <div
                        className={`mt-0.5 text-lg font-semibold ${
                          Number(detail.breakdown?.month_adjust_points || 0) >= 0
                            ? "text-[#2e77df]"
                            : "text-red-600"
                        }`}
                      >
                        {Number(detail.breakdown?.month_adjust_points || 0)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                      <div className="text-[11px] text-gray-500">Tổng điểm</div>
                      <div className="mt-0.5 text-lg font-semibold text-gray-900">
                        {Number(detail.breakdown?.total_score || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">
                      Điều chỉnh thêm theo tháng
                    </div>
                    <div className="mt-3">
                      <div className="text-[11px] text-gray-500">Cộng, trừ tháng (nhập số âm nếu trừ)</div>
                      <input
                        value={adjDelta}
                        onChange={(e) => setAdjDelta(e.target.value)}
                        className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                      />
                    </div>
                    <div className="mt-3">
                      <div className="text-[11px] text-gray-500">Lý do</div>
                      <input
                        value={adjReason}
                        onChange={(e) => setAdjReason(e.target.value)}
                        className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                      />
                    </div>
                    <button
                      onClick={saveAdjustment}
                      disabled={savingAdj || !!closedAt}
                      className="mt-3 w-full rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                    >
                      {closedAt ? "Tháng đã khóa" : savingAdj ? "Đang lưu..." : "Lưu"}
                    </button>
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
