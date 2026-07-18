import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import ModalShell from "../../components/ModalShell"
import {
  AdminBreadcrumb,
  AdminHeroCard,
  AdminPageShell,
  AdminSectionCard,
} from "../../components/admin/AdminUi"
import { usePageTitle } from "../../utils/usePageTitle"

type Month = {
  id: number
  semester_id: number
  semester_name: string
  month_number: number
  month_key: string
  name: string
  created_at?: string | null
}

type Week = {
  id: number
  month_id: number
  month_key?: string
  month_name?: string
  semester_name?: string
  week_number: number
  start_date: string
  end_date: string
}

type Assignment = {
  red_class: string
  duty_class: string
}

type GradeKey = "10" | "11" | "12"

type WeekForm = {
  week_number: string
  start_date: string
  end_date: string
  month_id: string
}

function monthDateValue(monthKey: string) {
  const match = String(monthKey || "").match(/^(\d{2})\/(\d{4})$/)
  if (!match) return 0
  return Number(`${match[2]}${match[1]}`)
}

function formatDate(date: string) {
  if (!date) return ""
  const [y, m, d] = date.split("-")
  return `${d}/${m}/${y}`
}

function toInputDate(date: string) {
  if (!date) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [d, m, y] = date.split("/")
  return `${y}-${m}-${d}`
}

function fromInputDate(date: string) {
  if (!date) return ""
  const [y, m, d] = date.split("-")
  return `${d}/${m}/${y}`
}

function autoEndDate(start: string) {
  const date = new Date(start)
  date.setDate(date.getDate() + 6)

  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")

  return `${d}/${m}/${y}`
}

function emptyWeekForm(monthId = ""): WeekForm {
  return {
    week_number: "",
    start_date: "",
    end_date: "",
    month_id: monthId,
  }
}

export default function AdminSchedule() {
  usePageTitle("EDP | Quản lý lịch trực")

  const [months, setMonths] = useState<Month[]>([])
  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [classes, setClasses] = useState<string[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [prevAssignments, setPrevAssignments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingWeek, setSavingWeek] = useState(false)
  const [savingAssignments, setSavingAssignments] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [weekForm, setWeekForm] = useState<WeekForm>(emptyWeekForm())

  const sortedMonths = useMemo(
    () =>
      months
        .slice()
        .sort((a, b) => {
          const byCreated = String(a.created_at || "").localeCompare(String(b.created_at || ""))
          if (byCreated !== 0) return byCreated
          return monthDateValue(a.month_key) - monthDateValue(b.month_key)
        }),
    [months],
  )

  const latestMonth = sortedMonths[sortedMonths.length - 1] || null
  const selectedWeek = useMemo(
    () => weeks.find((item) => Number(item.id) === Number(weekId)) || null,
    [weeks, weekId],
  )
  const sortedWeeks = useMemo(
    () =>
      weeks
        .slice()
        .sort((a, b) => Number(b.week_number) - Number(a.week_number) || b.start_date.localeCompare(a.start_date)),
    [weeks],
  )
  const grade10 = useMemo(() => classes.filter((item) => item.startsWith("10")), [classes])
  const grade11 = useMemo(() => classes.filter((item) => item.startsWith("11")), [classes])
  const grade12 = useMemo(() => classes.filter((item) => item.startsWith("12")), [classes])
  const usedClasses = useMemo(() => Object.values(assignments).filter(Boolean), [assignments])

  useEffect(() => {
    void boot()
  }, [])

  async function boot() {
    try {
      setLoading(true)
      const [timeRes, weeksRes, classesRes] = await Promise.all([
        api.get("/schedule/admin/time"),
        api.get<Week[]>("/schedule/admin"),
        api.get("/classes/admin"),
      ])

      const nextMonths: Month[] = timeRes.data.months || []
      const nextWeeks = weeksRes.data || []
      const classList = (classesRes.data || []).map((item: { name: string }) => item.name)

      classList.sort((a: string, b: string) => {
        const gA = parseInt(a, 10)
        const gB = parseInt(b, 10)
        if (gA !== gB) return gA - gB

        const nA = parseInt(a.split("A")[1], 10)
        const nB = parseInt(b.split("A")[1], 10)
        return nA - nB
      })

      setMonths(nextMonths)
      setWeeks(nextWeeks)
      setClasses(classList)

      const firstWeek = nextWeeks[0]
      if (firstWeek) {
        await loadWeek(firstWeek.id, nextWeeks)
      } else {
        clearSelectedWeek()
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được lịch trực")
    } finally {
      setLoading(false)
    }
  }

  async function reloadWeeks(preferredWeekId?: number) {
    const res = await api.get<Week[]>("/schedule/admin")
    const nextWeeks = res.data || []
    setWeeks(nextWeeks)

    const nextWeek = preferredWeekId
      ? nextWeeks.find((item) => item.id === preferredWeekId)
      : nextWeeks[0]

    if (nextWeek) {
      await loadWeek(nextWeek.id, nextWeeks)
    } else {
      clearSelectedWeek()
    }
  }

  function clearSelectedWeek() {
    setWeekId(null)
    setAssignments({})
    setPrevAssignments({})
  }

  function monthLabel(monthId?: number | string | null) {
    const month = months.find((item) => Number(item.id) === Number(monthId))
    if (!month) return "Chưa có tháng"
    return `${month.month_key} - ${month.semester_name}`
  }

  function openCreateWeekModal() {
    if (!months.length || !latestMonth) {
      toast.error("Hãy tạo tháng trong Quản lý thời gian trước")
      return
    }

    setWeekForm(emptyWeekForm(String(latestMonth.id)))
    setShowCreateModal(true)
  }

  async function loadWeek(id: number, sourceWeeks = weeks) {
    try {
      const res = await api.get(`/schedule/week/${id}`)
      const nextAssignments: Record<string, string> = {}

        ; (res.data.assignments || []).forEach((item: Assignment) => {
          nextAssignments[item.red_class] = item.duty_class
        })

      setAssignments(nextAssignments)
      setWeekId(id)
      setWeekForm({
        week_number: String(res.data.week?.week_number || ""),
        start_date: res.data.week?.start_date || "",
        end_date: res.data.week?.end_date || "",
        month_id: String(res.data.week?.month_id || ""),
      })

      const list = sourceWeeks.length ? sourceWeeks : weeks
      const index = list.findIndex((item) => item.id === id)

      if (index !== -1 && index < list.length - 1) {
        const previousWeekId = list[index + 1].id
        const previousRes = await api.get(`/schedule/week/${previousWeekId}`)
        const previousMap: Record<string, string> = {}

          ; (previousRes.data.assignments || []).forEach((item: Assignment) => {
            previousMap[item.red_class] = item.duty_class
          })

        setPrevAssignments(previousMap)
      } else {
        setPrevAssignments({})
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được tuần trực")
    }
  }

  function validateWeekForm(form: WeekForm) {
    const weekNumber = Number(form.week_number)
    if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
      toast.error("Số tuần không hợp lệ")
      return null
    }

    if (!form.month_id) {
      toast.error("Vui lòng chọn tháng")
      return null
    }

    if (!form.start_date || !form.end_date) {
      toast.error("Vui lòng nhập ngày bắt đầu và ngày kết thúc")
      return null
    }

    const start = toInputDate(form.start_date)
    const end = toInputDate(form.end_date)
    if (end < start) {
      toast.error("Ngày kết thúc phải sau ngày bắt đầu")
      return null
    }

    return {
      week_number: weekNumber,
      month_id: Number(form.month_id),
      start_date: form.start_date,
      end_date: form.end_date,
    }
  }

  async function createWeek() {
    const payload = validateWeekForm(weekForm)
    if (!payload) return

    try {
      setSavingWeek(true)
      const res = await api.post("/schedule/create-week", payload)
      setShowCreateModal(false)
      await reloadWeeks(res.data.week_id)
      toast.success("Đã tạo tuần")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tạo được tuần")
    } finally {
      setSavingWeek(false)
    }
  }

  async function updateWeek() {
    if (!weekId) return
    const payload = validateWeekForm(weekForm)
    if (!payload) return

    try {
      setSavingWeek(true)
      await api.post("/schedule/update-week", {
        week_id: weekId,
        ...payload,
      })
      await reloadWeeks(weekId)
      toast.success("Đã lưu thông tin tuần")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được tuần")
    } finally {
      setSavingWeek(false)
    }
  }

  async function deleteWeek() {
    if (!weekId) return

    const shouldDelete = window.confirm("Xóa tuần trực này?")
    if (!shouldDelete) return

    try {
      await api.delete(`/schedule/week/${weekId}`)
      await reloadWeeks()
      toast.success("Đã xóa tuần")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được tuần")
    }
  }

  function autoAssign(targetGrade: GradeKey, dutyGrade: GradeKey) {
    let redList: string[] = []
    let dutyList: string[] = []

    if (targetGrade === "10") redList = grade10
    if (targetGrade === "11") redList = grade11
    if (targetGrade === "12") redList = grade12

    if (dutyGrade === "10") dutyList = grade10
    if (dutyGrade === "11") dutyList = grade11
    if (dutyGrade === "12") dutyList = grade12

    const used = Object.values(assignments)
    const available = dutyList.filter((item) => !used.includes(item))
    const nextMap = { ...assignments }

    redList.forEach((redClass) => {
      let choices = available.filter((item) => item !== redClass)
      const previousDuty = prevAssignments[redClass]

      if (previousDuty) {
        choices = choices.filter((item) => item !== previousDuty)
      }

      if (choices.length === 0) {
        choices = dutyList.filter((item) => !used.includes(item) && item !== redClass)
      }

      if (choices.length === 0) return

      const dutyClass = choices[Math.floor(Math.random() * choices.length)]
      nextMap[redClass] = dutyClass

      const removeIndex = available.indexOf(dutyClass)
      if (removeIndex > -1) {
        available.splice(removeIndex, 1)
      }
    })

    setAssignments(nextMap)
  }

  function resetAssign(grade: GradeKey) {
    let list: string[] = []
    if (grade === "10") list = grade10
    if (grade === "11") list = grade11
    if (grade === "12") list = grade12

    const nextMap = { ...assignments }
    list.forEach((className) => {
      nextMap[className] = ""
    })
    setAssignments(nextMap)
  }

  function updateAssignment(redClass: string, dutyClass: string) {
    setAssignments((current) => ({
      ...current,
      [redClass]: dutyClass,
    }))
  }

  async function saveAssignments() {
    if (!weekId) return

    try {
      setSavingAssignments(true)
      const data = Object.keys(assignments).map((redClass) => ({
        red_class: redClass,
        duty_class: assignments[redClass],
      }))

      await api.post("/schedule/save", {
        week_id: weekId,
        assignments: data,
      })

      toast.success("Đã lưu phân công lịch trực")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được phân công")
    } finally {
      setSavingAssignments(false)
    }
  }

  function renderRow(list: string[]) {
    return (
      <tr>
        <td className="sticky left-0 z-10 min-w-[120px] bg-slate-50/95 px-4 py-4 font-semibold text-slate-700">
          Lớp trực
        </td>
        {list.map((className) => {
          const value = assignments[className] || ""
          return (
            <td key={className} className="border-l border-slate-100/80 px-3 py-3">
              <select
                value={value}
                onChange={(e) => updateAssignment(className, e.target.value)}
                className="min-w-[150px] rounded-[16px] border border-white/70 bg-white/80 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">--</option>
                {classes
                  .filter((item) => item !== className && (!usedClasses.includes(item) || item === value))
                  .map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
              </select>
            </td>
          )
        })}
      </tr>
    )
  }

  function renderBlock(title: string, list: string[], grade: GradeKey) {
    return (
      <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">Phân công lớp trực cho các lớp cờ đỏ trong cùng khối.</p>
          </div>

          <div className="flex flex-wrap gap-2 lg:ml-auto">
            {(["10", "11", "12"] as GradeKey[]).map((dutyGrade) => (
              <button
                key={dutyGrade}
                type="button"
                onClick={() => autoAssign(grade, dutyGrade)}
                className="min-h-10 rounded-[16px] border border-white/70 bg-white/78 px-3 text-xs font-semibold text-slate-700 shadow-[0_10px_20px_rgba(15,23,42,0.05)] transition duration-200 active:scale-[0.98]"
              >
                Trực khối {dutyGrade}
              </button>
            ))}
            <button
              type="button"
              onClick={() => resetAssign(grade)}
              className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
          <table className="w-max min-w-full text-sm">
            <thead className="bg-slate-50/90 text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50/95 px-4 py-4 text-left font-semibold">Cờ đỏ</th>
                {list.map((className) => (
                  <th key={className} className="border-l border-slate-100/80 px-4 py-4 text-center font-semibold">
                    {className}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{renderRow(list)}</tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderWeekForm(form: WeekForm, setForm: (next: WeekForm) => void) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-900">Tuần</span>
          <input
            type="number"
            min={1}
            value={form.week_number}
            onChange={(e) => setForm({ ...form, week_number: e.target.value })}
            className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
            placeholder="Ví dụ: 01"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-900">Tháng</span>
          <select
            value={form.month_id}
            onChange={(e) => setForm({ ...form, month_id: e.target.value })}
            className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
          >
            <option value="">Chọn tháng</option>
            {sortedMonths.map((month) => (
              <option key={month.id} value={month.id}>
                {monthLabel(month.id)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-900">Ngày bắt đầu</span>
          <input
            type="date"
            value={toInputDate(form.start_date)}
            onChange={(e) => {
              const start = fromInputDate(e.target.value)
              setForm({
                ...form,
                start_date: start,
                end_date: autoEndDate(e.target.value),
              })
            }}
            className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-900">Ngày kết thúc</span>
          <input
            type="date"
            value={toInputDate(form.end_date)}
            onChange={(e) => setForm({ ...form, end_date: fromInputDate(e.target.value) })}
            className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
          />
        </label>
      </div>
    )
  }

  return (
    <AdminPageShell>
      <AdminBreadcrumb current="Quản lý lịch trực" />

      <AdminHeroCard
        eyebrow="Lịch trực"
        title="Quản lý tuần trực"
        description="Trang này chỉ tạo, sửa và phân công lịch trực theo tuần. Học kỳ và tháng được quản lý riêng ở màn Quản lý thời gian."
        actions={
          <button
            type="button"
            onClick={openCreateWeekModal}
            className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
          >
            + Tạo tuần
          </button>
        }
      />

      {!months.length ? (
        <AdminSectionCard>
          <div className="rounded-[28px] border border-dashed border-blue-200 bg-blue-50/60 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Chưa có tháng để tạo tuần</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Hãy tạo học kỳ và tháng trước, sau đó quay lại màn này để tạo tuần trực.
            </p>
            <Link
              to="/admin/time-management"
              className="mt-4 inline-flex min-h-11 items-center rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)]"
            >
              Đi tới Quản lý thời gian
            </Link>
          </div>
        </AdminSectionCard>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)]">
          <AdminSectionCard className="h-fit">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Danh sách tuần</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Tháng mặc định khi tạo tuần: {latestMonth ? monthLabel(latestMonth.id) : "Chưa có tháng"}
                </p>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                {weeks.length} tuần
              </span>
            </div>

            <div className="mt-5 space-y-2">
              {loading ? (
                <div className="rounded-[22px] bg-white/70 p-4 text-sm text-slate-500">Đang tải tuần...</div>
              ) : sortedWeeks.length === 0 ? (
                <div className="rounded-[22px] bg-white/70 p-4 text-sm text-slate-500">
                  Chưa có tuần trực. Bấm “Tạo tuần” để bắt đầu.
                </div>
              ) : (
                sortedWeeks.map((week) => (
                  <button
                    key={week.id}
                    type="button"
                    onClick={() => void loadWeek(week.id, sortedWeeks)}
                    className={`w-full rounded-[22px] border px-4 py-3 text-left transition duration-200 active:scale-[0.99] ${week.id === weekId
                      ? "border-[#2e77df]/40 bg-[#2e77df]/10 shadow-[0_14px_30px_rgba(46,119,223,0.12)]"
                      : "border-white/70 bg-white/72 hover:bg-white/90"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-900">Tuần {week.week_number}</div>
                      <div className="text-xs text-slate-500">{week.month_key}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(week.start_date)} → {formatDate(week.end_date)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </AdminSectionCard>

          <AdminSectionCard>
            {!selectedWeek ? (
              <div className="rounded-[24px] bg-white/70 p-6 text-sm text-slate-500">
                Chọn một tuần để chỉnh sửa thông tin hoặc phân công lớp trực.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]/70">
                      Tuần đang chọn
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-slate-900">Tuần {selectedWeek.week_number}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedWeek.month_key} - {selectedWeek.semester_name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteWeek()}
                    className="min-h-10 rounded-[16px] border border-rose-100 bg-white px-4 text-sm font-semibold text-rose-600 transition duration-200 active:scale-[0.98] sm:ml-auto"
                  >
                    Xóa tuần
                  </button>
                </div>

                {renderWeekForm(weekForm, setWeekForm)}

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void updateWeek()}
                    disabled={savingWeek}
                    className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
                  >
                    {savingWeek ? "Đang lưu..." : "Lưu tuần"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveAssignments()}
                    disabled={savingAssignments}
                    className="min-h-11 rounded-[18px] bg-emerald-500 px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(16,185,129,0.2)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
                  >
                    {savingAssignments ? "Đang lưu..." : "Lưu phân công"}
                  </button>
                </div>
              </div>
            )}
          </AdminSectionCard>
        </div>
      )}

      {selectedWeek ? (
        <div className="space-y-6">
          {renderBlock("Khối 10", grade10, "10")}
          {renderBlock("Khối 11", grade11, "11")}
          {renderBlock("Khối 12", grade12, "12")}
        </div>
      ) : null}

      {showCreateModal && (
        <ModalShell className="max-w-lg border-white/70 bg-white/86 p-6 backdrop-blur-xl" onClose={() => setShowCreateModal(false)}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Tạo tuần mới</h2>
          </div>

          <div className="mt-5">{renderWeekForm(weekForm, setWeekForm)}</div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              disabled={savingWeek}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void createWeek()}
              disabled={savingWeek}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {savingWeek ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </ModalShell>
      )}
    </AdminPageShell>
  )
}
