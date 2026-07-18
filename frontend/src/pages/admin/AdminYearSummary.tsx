import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { usePageTitle } from "../../utils/usePageTitle"

type YearOption = {
  id: number
  year_key: string
  semester_keys: string[]
  closed_at: string | null
}

export default function AdminYearSummary() {
  usePageTitle("EDP | Tổng kết năm học")
  const [years, setYears] = useState<YearOption[]>([])
  const [yearKey, setYearKey] = useState("")

  const [loading, setLoading] = useState(true)
  const [closedAt, setClosedAt] = useState<string | null>(null)
  const [scoresByGrade, setScoresByGrade] = useState<any>({ 10: [], 11: [], 12: [] })

  const [detailClass, setDetailClass] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [adjPlus, setAdjPlus] = useState("0")
  const [adjMinus, setAdjMinus] = useState("0")
  const [adjReason, setAdjReason] = useState("")
  const [savingAdj, setSavingAdj] = useState(false)

  useEffect(() => {
    void boot()
  }, [])

  async function boot() {
    setLoading(true)
    try {
      const res = await api.get("/duty/admin/year/list")
      const list: YearOption[] = res.data.years || []
      setYears(list)
      if (!yearKey && list.length) {
        setYearKey(list[0].year_key)
        setClosedAt(list[0].closed_at || null)
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách năm học"))
    } finally {
      setLoading(false)
    }
  }

  function selectedYear() {
    return years.find((item) => item.year_key === yearKey) || null
  }

  async function preview() {
    if (!yearKey) {
      toast.error("Chọn năm học")
      return
    }
    setLoading(true)
    try {
      const res = await api.post("/duty/admin/year/preview", { year_key: yearKey })
      setClosedAt(res.data.closed_at || null)
      setScoresByGrade(res.data.scores_by_grade || { 10: [], 11: [], 12: [] })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được kết quả năm học"))
    } finally {
      setLoading(false)
    }
  }

  async function closeYear() {
    if (!yearKey) return
    if (!confirm("Tổng kết năm học và khóa chỉnh sửa?")) return
    try {
      await api.post("/duty/admin/year/close", { year_key: yearKey })
      toast.success("Đã tổng kết năm học")
      await preview()
      await boot()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tổng kết năm học"))
    }
  }

  async function reopenYear() {
    if (!yearKey) return
    if (!confirm("Mở khóa năm học này?")) return
    try {
      await api.post("/duty/admin/year/reopen", { year_key: yearKey })
      toast.success("Đã mở khóa năm học")
      await preview()
      await boot()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể mở khóa năm học"))
    }
  }

  async function exportExcel() {
    if (!yearKey) return
    try {
      const res = await api.get(`/duty/admin/year/${encodeURIComponent(yearKey)}/export`, {
        responseType: "blob",
      })
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ket_qua_thi_dua_nam_hoc_${yearKey}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được file Excel"))
    }
  }

  async function openDetail(className: string) {
    if (!yearKey) return
    setDetailClass(className)
    setDetail(null)
    try {
      const res = await api.get(
        `/duty/admin/year/${encodeURIComponent(yearKey)}/class/${encodeURIComponent(className)}/breakdown`,
      )
      setDetail(res.data)
      setAdjPlus(String(res.data?.breakdown?.adjust_plus ?? 0))
      setAdjMinus(String(res.data?.breakdown?.adjust_minus ?? 0))
      setAdjReason(String(res.data?.breakdown?.adjust_reason ?? ""))
    } catch (err) {
      setDetailClass(null)
      toast.error(getApiErrorMessage(err, "Không tải được chi tiết lớp"))
    }
  }

  async function saveAdjustment() {
    if (!detailClass || !yearKey) return
    setSavingAdj(true)
    try {
      await api.post("/duty/admin/year/adjustment", {
        year_key: yearKey,
        class_name: detailClass,
        plus_points: Number(adjPlus || 0),
        minus_points: Number(adjMinus || 0),
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
    if (!detailClass || !yearKey) return
    if (!confirm("Xóa điểm cộng/trừ của lớp này?")) return
    setSavingAdj(true)
    try {
      await api.delete("/duty/admin/year/adjustment", {
        data: { year_key: yearKey, class_name: detailClass },
      })
      setAdjPlus("0")
      setAdjMinus("0")
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

  const currentYear = selectedYear()

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Tổng kết năm học</span>
        </div>

        <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Tổng kết năm học</div>
              <div className="mt-1 text-sm text-gray-600">
                Chọn năm học đã tạo trong quản lý lịch trực. Hệ thống tự lấy toàn bộ học kỳ, tháng và tuần.
              </div>
              {closedAt ? <div className="mt-1 text-xs text-gray-500">Đã tổng kết: {closedAt}</div> : null}
            </div>

            <div className="lg:ml-auto w-full lg:w-80">
              <select
                value={yearKey}
                onChange={(e) => {
                  const key = e.target.value
                  setYearKey(key)
                  const year = years.find((item) => item.year_key === key)
                  setClosedAt(year?.closed_at || null)
                }}
                className="w-full rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Chọn năm học</option>
                {years.map((year) => (
                  <option key={year.year_key} value={year.year_key}>
                    {year.year_key}
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
              onClick={exportExcel}
              disabled={!yearKey}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Xuất Excel
            </button>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 flex flex-wrap gap-3 items-center">
            <button
              onClick={closeYear}
              disabled={!!closedAt || !yearKey}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              Tổng kết & khóa
            </button>
            <button
              onClick={reopenYear}
              disabled={!closedAt || !yearKey}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Mở khóa
            </button>
            <div className="text-xs text-gray-600 ml-auto">
              {currentYear ? `${currentYear.semester_keys.length} học kỳ thuộc năm học` : "Chưa chọn năm học"}
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
                    <div className="mt-0.5 text-2xl font-semibold text-gray-900">
                      {Number(detail.breakdown?.total_score || 0)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">Điểm cộng trừ riêng theo năm học</div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] text-gray-500">Điểm cộng</div>
                        <input
                          value={adjPlus}
                          onChange={(e) => setAdjPlus(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-500">Điểm trừ</div>
                        <input
                          value={adjMinus}
                          onChange={(e) => setAdjMinus(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                        />
                      </div>
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
                      {closedAt ? "Năm học đã khóa" : savingAdj ? "Đang lưu..." : "Lưu"}
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
