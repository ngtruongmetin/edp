import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { usePageTitle } from "../../utils/usePageTitle"

type MonthOption = {
  id: number
  month_key: string
  name: string
  semester_name: string
  school_year_name: string
  week_ids: number[]
  closed_at: string | null
}

export default function AdminMonthSummary() {
  usePageTitle("EDP | Tổng kết tháng")
  const [months, setMonths] = useState<MonthOption[]>([])
  const [monthKey, setMonthKey] = useState("")
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
    void boot()
  }, [])

  async function boot() {
    setLoading(true)
    try {
      const res = await api.get("/duty/admin/month/list")
      const list: MonthOption[] = res.data.months || []
      setMonths(list)
      if (!monthKey && list.length) {
        setMonthKey(list[0].month_key)
        setClosedAt(list[0].closed_at || null)
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách tháng"))
    } finally {
      setLoading(false)
    }
  }

  function selectedMonth() {
    return months.find((item) => item.month_key === monthKey) || null
  }

  async function preview() {
    if (!monthKey) {
      toast.error("Chọn tháng")
      return
    }
    setLoading(true)
    try {
      const res = await api.post("/duty/admin/month/preview", { month_key: monthKey })
      setClosedAt(res.data.closed_at || null)
      setScoresByGrade(res.data.scores_by_grade || { 10: [], 11: [], 12: [] })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được kết quả tháng"))
    } finally {
      setLoading(false)
    }
  }

  async function closeMonth() {
    if (!monthKey) return
    if (!confirm("Tổng kết tháng và khóa chỉnh sửa?")) return
    try {
      await api.post("/duty/admin/month/close", { month_key: monthKey })
      toast.success("Đã tổng kết tháng")
      await preview()
      await boot()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tổng kết tháng"))
    }
  }

  async function reopenMonth() {
    if (!monthKey) return
    if (!confirm("Mở khóa tháng này?")) return
    try {
      await api.post("/duty/admin/month/reopen", { month_key: monthKey })
      toast.success("Đã mở khóa tháng")
      await preview()
      await boot()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể mở khóa tháng"))
    }
  }

  async function exportExcel() {
    if (!monthKey) return
    try {
      const res = await api.get(`/duty/admin/month/${encodeURIComponent(monthKey)}/export`, {
        responseType: "blob",
      })
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ket_qua_thi_dua_thang_${monthKey.replace(/[\\/]/g, "-")}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được file Excel"))
    }
  }

  async function openDetail(className: string) {
    if (!monthKey) return
    setDetailClass(className)
    setDetail(null)
    try {
      const res = await api.get(
        `/duty/admin/month/${encodeURIComponent(monthKey)}/class/${encodeURIComponent(className)}/breakdown`,
      )
      setDetail(res.data)
      const delta =
        Number(res.data?.breakdown?.adjust_plus || 0) -
        Number(res.data?.breakdown?.adjust_minus || 0)
      setAdjDelta(String(delta))
      setAdjReason(String(res.data?.breakdown?.adjust_reason ?? ""))
    } catch (err) {
      setDetailClass(null)
      toast.error(getApiErrorMessage(err, "Không tải được chi tiết lớp"))
    }
  }

  async function saveAdjustment() {
    if (!detailClass || !monthKey) return
    setSavingAdj(true)
    try {
      const delta = Number(adjDelta || 0)
      await api.post("/duty/admin/month/adjustment", {
        month_key: monthKey,
        class_name: detailClass,
        plus_points: delta > 0 ? delta : 0,
        minus_points: delta < 0 ? -delta : 0,
        reason: adjReason,
      })
      toast.success("Đã lưu")
      await preview()
      await openDetail(detailClass)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể lưu điều chỉnh"))
    } finally {
      setSavingAdj(false)
    }
  }

  async function deleteAdjustment() {
    if (!detailClass || !monthKey) return
    if (!confirm("Xóa điểm cộng/trừ của lớp này?")) return
    setSavingAdj(true)
    try {
      await api.delete("/duty/admin/month/adjustment", {
        data: { month_key: monthKey, class_name: detailClass },
      })
      setAdjDelta("0")
      setAdjReason("")
      toast.success("Đã xóa")
      await preview()
      await openDetail(detailClass)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể xóa điều chỉnh"))
    } finally {
      setSavingAdj(false)
    }
  }

  async function uploadMonthAdjustmentFile(file: File) {
    if (!monthKey) {
      toast.error("Chọn tháng trước")
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
        month_key: monthKey,
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

  async function downloadAdjustmentTemplate() {
    try {
      const res = await api.get("/duty/admin/month/adjustment/template", {
        responseType: "blob",
      })
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "template_month_adjustments.xlsx"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Không tải được file mẫu")
    }
  }

  const currentMonth = selectedMonth()

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Tổng kết tháng</span>
        </div>

        <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Tổng kết tháng</div>
              <div className="mt-1 text-sm text-gray-600">
                Chọn tháng đã tạo trong quản lý lịch trực. Hệ thống tự lấy toàn bộ tuần thuộc tháng.
              </div>
              {closedAt ? <div className="mt-1 text-xs text-gray-500">Đã tổng kết: {closedAt}</div> : null}
            </div>

            <div className="lg:ml-auto w-full lg:w-80">
              <select
                value={monthKey}
                onChange={(e) => {
                  const key = e.target.value
                  setMonthKey(key)
                  const month = months.find((item) => item.month_key === key)
                  setClosedAt(month?.closed_at || null)
                }}
                className="w-full rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Chọn tháng</option>
                {months.map((month) => (
                  <option key={month.month_key} value={month.month_key}>
                    {month.name} ({month.month_key}) - {month.semester_name}, {month.school_year_name}
                  </option>
                ))}
              </select>
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
              disabled={!monthKey || !!closedAt || uploadingMonthAdj}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              {uploadingMonthAdj ? "Đang nhập..." : "Nhập Excel cộng/trừ"}
            </button>
            <button
              onClick={() => void downloadAdjustmentTemplate()}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
            >
              Tải file mẫu
            </button>
            <button
              onClick={exportExcel}
              disabled={!monthKey}
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
                if (file) void uploadMonthAdjustmentFile(file)
              }}
            />
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 flex flex-wrap gap-3 items-center">
            <button
              onClick={closeMonth}
              disabled={!!closedAt || !monthKey}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              Tổng kết & khóa
            </button>
            <button
              onClick={reopenMonth}
              disabled={!closedAt || !monthKey}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Mở khóa
            </button>
            <div className="text-xs text-gray-600 ml-auto">
              {currentMonth ? `${currentMonth.week_ids.length} tuần thuộc tháng` : "Chưa chọn tháng"}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
            <div className="text-sm text-gray-600">Đang tải dữ liệu...</div>
          </div>
        ) : (
          <div className="space-y-4">
            {([10, 11, 12] as const).map((g) => (
              <div key={g} className="edp-glass-panel rounded-[32px] p-0 overflow-hidden">
                <div className="px-5 py-4 flex items-center">
                  <div className="text-sm font-semibold text-gray-900">Khối {g}</div>
                  <div className="ml-auto text-xs text-gray-500">{(scoresByGrade?.[g] || []).length} lớp</div>
                </div>
                <div className="divide-y divide-blue-50">
                  {(scoresByGrade?.[g] || []).map((r: any, idx: number) => (
                    <button
                      key={r.class_name}
                      onClick={() => void openDetail(r.class_name)}
                      className="w-full px-5 py-4 flex items-center text-left hover:bg-slate-50 transition"
                    >
                      <div className="w-10 text-sm font-semibold text-gray-500">
                        #{Number(r.rank || 0) > 0 ? r.rank : idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">{r.class_name}</div>
                        {r.note ? <div className="text-xs font-semibold text-amber-700">{r.note}</div> : null}
                      </div>
                      <div className="text-lg font-semibold text-gray-900">{r.total_score}</div>
                    </button>
                  ))}
                  {(scoresByGrade?.[g] || []).length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-600">Chưa có dữ liệu.</div>
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
                <div className="text-base font-semibold text-gray-900">Chi tiết điểm: {detailClass}</div>
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
                          Number(detail.breakdown?.month_adjust_points || 0) >= 0 ? "text-[#2e77df]" : "text-red-600"
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
                    <div className="text-sm font-semibold text-gray-900">Điều chỉnh thêm theo tháng</div>
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
                    <button
                      onClick={() => void deleteAdjustment()}
                      disabled={savingAdj || !!closedAt}
                      className="mt-2 w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm ring-1 ring-red-100 disabled:opacity-50"
                    >
                      Xóa điều chỉnh
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
