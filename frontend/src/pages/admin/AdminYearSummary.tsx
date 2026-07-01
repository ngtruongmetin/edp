import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import toast from "react-hot-toast"
import { usePageTitle } from "../../utils/usePageTitle"

export default function AdminYearSummary() {
  usePageTitle("EDP | Tổng kết năm học")
  const [semesters, setSemesters] = useState<any[]>([])
  const [yearKey, setYearKey] = useState("2025-2026")
  const [savedYearKey, setSavedYearKey] = useState<string | null>(null)
  const [semesterKeys, setSemesterKeys] = useState<string[]>([])

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
    boot()
  }, [])

  async function boot() {
    setLoading(true)
    try {
      const res = await api.get("/duty/admin/semester/list")
      setSemesters(res.data.semesters || [])
    } finally {
      setLoading(false)
    }
  }

  const semesterOptions = useMemo(() => {
    return semesters.map((s: any) => ({
      key: s.semester_key,
      label: s.semester_key,
    }))
  }, [semesters])

  function toggleSemester(key: string) {
    setSemesterKeys((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]))
  }

  function buildYearKey() {
    const y = yearKey.trim()
    if (!/^\d{4}-\d{4}$/.test(y)) return null
    return y
  }

  async function preview() {
    const key = buildYearKey()
    if (!key) {
      toast.error("Nhập năm học dạng yyyy-yyyy")
      return
    }
    if (semesterKeys.length === 0) {
      toast.error("Chọn ít nhất 1 học kỳ")
      return
    }
    setLoading(true)
    try {
      const res = await api.post("/duty/admin/year/preview", {
        year_key: key,
        semester_keys: semesterKeys,
      })
      setSavedYearKey(res.data.year_key)
      setClosedAt(res.data.closed_at || null)
      setScoresByGrade(res.data.scores_by_grade || { 10: [], 11: [], 12: [] })
    } finally {
      setLoading(false)
    }
  }

  async function saveYear() {
    const key = buildYearKey()
    if (!key) {
      toast.error("Nhập năm học dạng yyyy-yyyy")
      return
    }
    if (semesterKeys.length === 0) {
      toast.error("Chọn ít nhất 1 học kỳ")
      return
    }
    await api.post("/duty/admin/year/save", {
      year_key: key,
      semester_keys: semesterKeys,
    })
    toast.success("Đã lưu năm học")
  }

  async function closeYear() {
    const key = buildYearKey()
    if (!key) return
    if (!confirm("Tổng kết năm học và khóa chỉnh sửa?")) return
    await api.post("/duty/admin/year/close", { year_key: key, semester_keys: semesterKeys })
    await preview()
  }

  async function reopenYear() {
    const key = buildYearKey()
    if (!key) return
    if (!confirm("Mở khóa năm học này?")) return
    await api.post("/duty/admin/year/reopen", { year_key: key })
    await preview()
  }

  async function exportExcel() {
    const key = savedYearKey || buildYearKey()
    if (!key) return
    const res = await api.get(`/duty/admin/year/${encodeURIComponent(key)}/export`, {
      responseType: "blob",
    })
    const blob = new Blob([res.data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ket_qua_thi_dua_nam_hoc_${key}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function openDetail(className: string) {
    const key = savedYearKey || buildYearKey()
    if (!key) return
    setDetailClass(className)
    setDetail(null)
    const res = await api.get(
      `/duty/admin/year/${encodeURIComponent(key)}/class/${encodeURIComponent(className)}/breakdown`,
    )
    setDetail(res.data)
    setAdjPlus(String(res.data?.breakdown?.adjust_plus ?? 0))
    setAdjMinus(String(res.data?.breakdown?.adjust_minus ?? 0))
    setAdjReason(String(res.data?.breakdown?.adjust_reason ?? ""))
  }

  async function saveAdjustment() {
    if (!detailClass) return
    const key = savedYearKey || buildYearKey()
    if (!key) return
    setSavingAdj(true)
    try {
      await api.post("/duty/admin/year/adjustment", {
        year_key: key,
        class_name: detailClass,
        plus_points: Number(adjPlus || 0),
        minus_points: Number(adjMinus || 0),
        reason: adjReason,
      })
      toast.success("Đã lưu")
      await preview()
      await openDetail(detailClass)
    } finally {
      setSavingAdj(false)
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
          <span className="font-medium text-gray-700">Tổng kết năm học</span>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Tổng kết năm học</div>
              <div className="mt-1 text-sm text-gray-600">
                Chọn năm học và các học kỳ cần tính. Có điểm cộng trừ riêng theo năm học, khóa và xuất Excel.
              </div>
              {closedAt ? (
                <div className="mt-1 text-xs text-gray-500">Đã tổng kết: {closedAt}</div>
              ) : null}
            </div>

            <div className="lg:ml-auto grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
              <input
                value={yearKey}
                onChange={(e) => setYearKey(e.target.value)}
                placeholder="yyyy-yyyy"
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              />
              <button
                onClick={saveYear}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
              >
                Lưu năm học
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
              onClick={exportExcel}
              disabled={!buildYearKey()}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Xuất Excel
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Chọn học kỳ</div>
              <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
                {semesterOptions.map((s) => (
                  <label
                    key={s.key}
                    className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-blue-50"
                  >
                    <input
                      type="checkbox"
                      checked={semesterKeys.includes(s.key)}
                      onChange={() => toggleSemester(s.key)}
                    />
                    <span className="text-sm text-gray-800">{s.label}</span>
                  </label>
                ))}
                {semesterOptions.length === 0 ? (
                  <div className="text-sm text-gray-600">Chưa có học kỳ.</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 flex flex-wrap gap-3 items-center">
              <button
                onClick={closeYear}
                disabled={!!closedAt || !buildYearKey()}
                className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
              >
                Tổng kết & khóa
              </button>
              <button
                onClick={reopenYear}
                disabled={!closedAt || !buildYearKey()}
                className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
              >
                Mở khóa
              </button>
              <div className="text-xs text-gray-600 ml-auto">{semesterKeys.length} học kỳ được chọn</div>
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
                    <div className="mt-0.5 text-2xl font-semibold text-gray-900">
                      {Number(detail.breakdown?.total_score || 0)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">
                      Điểm cộng trừ riêng theo năm học
                    </div>
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
