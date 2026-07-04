import { useEffect, useMemo, useState } from "react"
import { api } from "../api/api"
import Footer from "../components/Footer"
import Navbar from "../components/Navbar"
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

function formatDateVN(dateStr: string) {
  if (!dateStr) return ""
  const [year, month, day] = dateStr.split("-")
  return `${day}/${month}/${year}`
}

function gradeFromClass(name?: string) {
  const value = String(name || "").trim().toUpperCase()
  const grade = parseInt(value, 10)
  return Number.isFinite(grade) ? grade : null
}

function sortClass(a: Assignment, b: Assignment) {
  const gradeA = gradeFromClass(a.red_class) || 0
  const gradeB = gradeFromClass(b.red_class) || 0
  if (gradeA !== gradeB) return gradeA - gradeB

  const numberA = parseInt(String(a.red_class || "").split("A")[1] || "0", 10)
  const numberB = parseInt(String(b.red_class || "").split("A")[1] || "0", 10)
  return numberA - numberB
}

function GradeColumn({
  title,
  items,
  accent,
}: {
  title: string
  items: Assignment[]
  accent: string
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-xs text-slate-500">{items.length} lớp</div>
      </div>

      <div className="p-4">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Chưa có lịch cho khối này.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={`${item.red_class}-${item.duty_class}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{item.red_class}</div>
                  <div className="truncate text-xs text-slate-500">Trực lớp {item.duty_class}</div>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${accent}`}>
                  {item.duty_class}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
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
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const currentWeek = useMemo(() => {
    return weeks.find((week) => week.id === weekId) || null
  }, [weeks, weekId])

  const assignmentsByGrade = useMemo(() => {
    const list = currentWeek?.assignments || []
    const g10 = list.filter((item) => gradeFromClass(item.red_class) === 10).sort(sortClass)
    const g11 = list.filter((item) => gradeFromClass(item.red_class) === 11).sort(sortClass)
    const g12 = list.filter((item) => gradeFromClass(item.red_class) === 12).sort(sortClass)
    return { g10, g11, g12 }
  }, [currentWeek])

  const weekLabel = currentWeek
    ? `Tuần ${currentWeek.week_number}`
    : "Chưa có dữ liệu"

  const weekDates = currentWeek
    ? `${formatDateVN(currentWeek.start_date)} đến ${formatDateVN(currentWeek.end_date)}`
    : "Chưa có tuần được chọn"

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      <Navbar />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]">
                Lịch trực
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Phân công theo tuần
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Chọn tuần để xem phân công của từng khối.
              </p>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <label className="text-sm font-semibold text-slate-900">Chọn tuần</label>
              <select
                value={weekId ?? ""}
                onChange={(event) => setWeekId(Number(event.target.value))}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#2e77df] focus:bg-white"
              >
                {weeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    Tuần {week.week_number} ({formatDateVN(week.start_date)} - {formatDateVN(week.end_date)})
                  </option>
                ))}
              </select>

              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tuần hiện tại</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{weekLabel}</div>
                <div className="mt-1 text-sm text-slate-600">{weekDates}</div>
              </div>
            </div>
          </aside>

          <section className="space-y-4">
            {loading ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {["Khối 10", "Khối 11", "Khối 12"].map((label) => (
                  <div
                    key={label}
                    className="h-80 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
                  >
                    <div className="h-4 w-24 rounded-full bg-slate-100" />
                    <div className="mt-3 h-3 w-16 rounded-full bg-slate-100" />
                    <div className="mt-5 space-y-3">
                      <div className="h-14 rounded-2xl bg-slate-50" />
                      <div className="h-14 rounded-2xl bg-slate-50" />
                      <div className="h-14 rounded-2xl bg-slate-50" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !currentWeek ? (
              <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                Chưa có dữ liệu lịch trực.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                <GradeColumn title="Khối 10" items={assignmentsByGrade.g10} accent="bg-blue-50 text-[#2e77df]" />
                <GradeColumn title="Khối 11" items={assignmentsByGrade.g11} accent="bg-emerald-50 text-emerald-700" />
                <GradeColumn title="Khối 12" items={assignmentsByGrade.g12} accent="bg-amber-50 text-amber-700" />
              </div>
            )}
          </section>
        </section>
      </main>

      <Footer />
    </div>
  )
}
