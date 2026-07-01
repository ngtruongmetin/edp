import { useEffect, useMemo, useState } from "react"
import { api } from "../api/api"
import Navbar from "../components/Navbar"
import Footer from "../components/Footer"
import { usePageTitle } from "../utils/usePageTitle"

type Assignment = {
  red_class: string
  duty_class: string
}

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
  assignments: Assignment[]
}

export default function Schedule() {
  usePageTitle("EDP | Lịch trực")
  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadWeeks()
  }, [])

  async function loadWeeks() {
    try {
      setLoading(true)
      const res = await api.get("/schedule/all")
      const list: Week[] = res.data.weeks || []
      setWeeks(list)
      setWeekId(list[0]?.id ?? null)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function formatDateVN(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  function gradeFromClass(name?: string) {
    const n = String(name || "").trim().toUpperCase()
    const g = parseInt(n, 10)
    return Number.isFinite(g) ? g : null
  }

  function sortClass(a: Assignment, b: Assignment) {
    const ga = gradeFromClass(a.red_class) || 0
    const gb = gradeFromClass(b.red_class) || 0
    if (ga !== gb) return ga - gb
    const na = parseInt(String(a.red_class || "").split("A")[1] || "0", 10)
    const nb = parseInt(String(b.red_class || "").split("A")[1] || "0", 10)
    return na - nb
  }

  const currentWeek = useMemo(() => {
    return weeks.find((w) => w.id === weekId) || null
  }, [weeks, weekId])

  const assignmentsByGrade = useMemo(() => {
    const list = currentWeek?.assignments || []
    const g10 = list.filter((a) => gradeFromClass(a.red_class) === 10).sort(sortClass)
    const g11 = list.filter((a) => gradeFromClass(a.red_class) === 11).sort(sortClass)
    const g12 = list.filter((a) => gradeFromClass(a.red_class) === 12).sort(sortClass)
    return { g10, g11, g12 }
  }, [currentWeek])

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 w-full">
        <div className="max-w-6xl mx-auto px-4 pt-8 pb-6">
          <div className="text-[#2e77df] text-2xl sm:text-3xl font-semibold">
            Phân công lịch trực
          </div>
          <div className="mt-1 text-sm sm:text-base text-gray-600">
            {currentWeek
              ? `Tuần ${currentWeek.week_number}: từ ngày ${formatDateVN(
                  currentWeek.start_date,
                )} đến ngày ${formatDateVN(currentWeek.end_date)}`
              : "Tuần --: từ ngày --/--/---- đến ngày --/--/----"}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-10">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="text-sm font-semibold text-gray-900">Chọn tuần</div>
              <select
                value={weekId ?? ""}
                onChange={(e) => setWeekId(Number(e.target.value))}
                className="w-full sm:max-w-md rounded-2xl border border-blue-100 bg-white px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    Tuần {w.week_number} ({formatDateVN(w.start_date)} - {formatDateVN(w.end_date)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 text-sm text-gray-600">Đang tải lịch trực...</div>
          ) : !currentWeek ? (
            <div className="mt-6 text-sm text-gray-600">Chưa có dữ liệu tuần.</div>
          ) : (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[
                { label: "Khối 10", list: assignmentsByGrade.g10, tone: "from-blue-50 to-white" },
                { label: "Khối 11", list: assignmentsByGrade.g11, tone: "from-emerald-50 to-white" },
                { label: "Khối 12", list: assignmentsByGrade.g12, tone: "from-amber-50 to-white" },
              ].map((g) => (
                <div key={g.label} className="rounded-3xl bg-white shadow-sm ring-1 ring-blue-50 overflow-hidden">
                  <div className={`px-5 py-4 bg-gradient-to-br ${g.tone}`}>
                    <div className="text-sm font-semibold text-gray-900">{g.label}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {g.list.length} lớp
                    </div>
                  </div>

                  {g.list.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-600">Chưa có lịch cho khối này.</div>
                  ) : (
                    <div className="divide-y divide-blue-50">
                      {g.list.map((a) => (
                        <div key={`${a.red_class}-${a.duty_class}`} className="px-5 py-3 flex items-center">
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-semibold text-gray-900">{a.red_class}</div>
                            <div className="text-xs text-gray-500">Trực lớp {a.duty_class}</div>
                          </div>
                          <div className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">
                            {a.duty_class}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  )
}
