import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import ModalShell from "../../components/ModalShell"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

type Assignment = {
  red_class: string
  duty_class: string
}

type GradeKey = "10" | "11" | "12"

export default function AdminSchedule() {
  usePageTitle("EDP | Lịch trực")

  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [editStartDate, setEditStartDate] = useState("")
  const [editEndDate, setEditEndDate] = useState("")
  const [classes, setClasses] = useState<string[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [prevAssignments, setPrevAssignments] = useState<Record<string, string>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [loadingWeeks, setLoadingWeeks] = useState(true)
  const [savingWeek, setSavingWeek] = useState(false)
  const [newWeek, setNewWeek] = useState({
    week_number: "",
    start_date: "",
    end_date: "",
  })

  function formatDate(date: string) {
    if (!date) return ""
    const [y, m, d] = date.split("-")
    return `${d}/${m}/${y}`
  }

  function toInputDate(date: string) {
    if (!date) return ""
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

  useEffect(() => {
    void Promise.all([loadWeeks(), loadClasses()])
  }, [])

  const grade10 = useMemo(() => classes.filter((item) => item.startsWith("10")), [classes])
  const grade11 = useMemo(() => classes.filter((item) => item.startsWith("11")), [classes])
  const grade12 = useMemo(() => classes.filter((item) => item.startsWith("12")), [classes])

  const usedClasses = useMemo(() => Object.values(assignments).filter(Boolean), [assignments])

  async function loadWeeks() {
    try {
      setLoadingWeeks(true)
      const res = await api.get<Week[]>("/schedule/admin")
      const data = res.data || []
      setWeeks(data)

      if (data.length > 0) {
        await loadWeek(data[0].id, data)
      } else {
        setWeekId(null)
        setAssignments({})
        setPrevAssignments({})
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được lịch trực")
    } finally {
      setLoadingWeeks(false)
    }
  }

  async function loadClasses() {
    try {
      const res = await api.get("/classes/admin")
      const list = (res.data || []).map((item: { name: string }) => item.name)

      list.sort((a: string, b: string) => {
        const gA = parseInt(a, 10)
        const gB = parseInt(b, 10)
        if (gA !== gB) return gA - gB

        const nA = parseInt(a.split("A")[1], 10)
        const nB = parseInt(b.split("A")[1], 10)
        return nA - nB
      })

      setClasses(list)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được danh sách lớp")
    }
  }

  async function loadWeek(id: number, sourceWeeks = weeks) {
    try {
      const res = await api.get(`/schedule/week/${id}`)
      const nextAssignments: Record<string, string> = {}

      ;(res.data.assignments || []).forEach((item: Assignment) => {
        nextAssignments[item.red_class] = item.duty_class
      })

      setAssignments(nextAssignments)
      setWeekId(id)
      setEditStartDate(res.data.week?.start_date || "")
      setEditEndDate(res.data.week?.end_date || "")

      const list = sourceWeeks.length ? sourceWeeks : weeks
      const index = list.findIndex((item) => item.id === id)

      if (index !== -1 && index < list.length - 1) {
        const previousWeekId = list[index + 1].id
        const previousRes = await api.get(`/schedule/week/${previousWeekId}`)
        const previousMap: Record<string, string> = {}

        ;(previousRes.data.assignments || []).forEach((item: Assignment) => {
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

  async function updateWeekDates() {
    if (!weekId) return

    if (!editStartDate || !editEndDate) {
      toast.error("Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc")
      return
    }

    if (editStartDate > editEndDate) {
      toast.error("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc")
      return
    }

    try {
      await api.post("/schedule/update-week", {
        week_id: weekId,
        start_date: editStartDate,
        end_date: editEndDate,
      })

      setWeeks((current) =>
        current.map((item) =>
          item.id === weekId
            ? { ...item, start_date: editStartDate, end_date: editEndDate }
            : item,
        ),
      )
      toast.success("Đã cập nhật tuần")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không thể cập nhật tuần")
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

  function update(redClass: string, dutyClass: string) {
    setAssignments((current) => ({
      ...current,
      [redClass]: dutyClass,
    }))
  }

  async function save() {
    if (!weekId) return

    try {
      setSavingWeek(true)
      const data = Object.keys(assignments).map((redClass) => ({
        red_class: redClass,
        duty_class: assignments[redClass],
      }))

      await api.post("/schedule/save", {
        week_id: weekId,
        assignments: data,
      })

      toast.success("Đã lưu lịch trực")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được lịch trực")
    } finally {
      setSavingWeek(false)
    }
  }

  async function createWeek() {
    const { week_number, start_date, end_date } = newWeek

    if (!week_number || !start_date || !end_date) {
      toast.error("Vui lòng nhập đầy đủ thông tin tuần")
      return
    }

    const start = new Date(toInputDate(start_date))
    const end = new Date(toInputDate(end_date))
    if (end < start) {
      toast.error("Ngày kết thúc phải sau ngày bắt đầu")
      return
    }

    try {
      const res = await api.post("/schedule/create-week", {
        week_number,
        start_date,
        end_date,
      })

      setShowCreateModal(false)
      setNewWeek({
        week_number: "",
        start_date: "",
        end_date: "",
      })

      await loadWeeks()
      await loadWeek(res.data.week_id)
      toast.success("Đã tạo tuần mới")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tạo được tuần mới")
    }
  }

  async function deleteWeek() {
    if (!weekId) return

    const shouldDelete = window.confirm("Xóa tuần trực này?")
    if (!shouldDelete) return

    try {
      await api.delete(`/schedule/week/${weekId}`)
      await loadWeeks()
      toast.success("Đã xóa tuần")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được tuần")
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
                onChange={(e) => update(className, e.target.value)}
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

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="transition hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Quản lý lịch trực</span>
        </div>

        <section className="edp-glass-panel rounded-[32px] px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
                Lịch trực
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Lịch trực cờ đỏ
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Tạo tuần trực, chỉnh ngày áp dụng và phân công lớp trực theo từng khối trong cùng giao diện.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              + Tạo tuần
            </button>
          </div>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-end">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Chọn tuần</span>
              <select
                value={weekId || ""}
                onChange={(e) => void loadWeek(Number(e.target.value))}
                className="w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              >
                {weeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    Tuần {week.week_number} ({formatDate(week.start_date)} → {formatDate(week.end_date)})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void save()}
              disabled={!weekId || savingWeek}
              className="min-h-11 rounded-[18px] bg-emerald-500 px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(16,185,129,0.2)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {savingWeek ? "Đang lưu..." : "Lưu"}
            </button>

            <button
              type="button"
              onClick={() => void deleteWeek()}
              disabled={!weekId}
              className="min-h-11 rounded-[18px] border border-rose-100 bg-white px-4 text-sm font-semibold text-rose-600 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Xóa tuần
            </button>
          </div>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Ngày bắt đầu</span>
              <input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className="w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Ngày kết thúc</span>
              <input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                className="w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              />
            </label>

            <button
              type="button"
              onClick={() => void updateWeekDates()}
              disabled={!weekId}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Cập nhật tuần
            </button>
          </div>
        </section>

        {loadingWeeks ? (
          <section className="edp-glass-panel rounded-[32px] p-6 text-sm text-slate-500">
            Đang tải lịch trực...
          </section>
        ) : weeks.length === 0 ? (
          <section className="edp-glass-panel rounded-[32px] p-10 text-center text-sm text-slate-500">
            Chưa có tuần trực nào. Hãy tạo tuần mới để bắt đầu phân công.
          </section>
        ) : (
          <div className="space-y-6">
            {renderBlock("Khối 10", grade10, "10")}
            {renderBlock("Khối 11", grade11, "11")}
            {renderBlock("Khối 12", grade12, "12")}
          </div>
        )}
      </div>

      <Footer />

      {showCreateModal && (
        <ModalShell className="max-w-lg p-6" onClose={() => setShowCreateModal(false)}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Tạo tuần mới</h2>
            <p className="mt-1 text-sm text-slate-600">Thiết lập số tuần và khoảng ngày áp dụng cho lịch trực.</p>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Tuần số</span>
              <input
                type="number"
                value={newWeek.week_number}
                onChange={(e) => setNewWeek((current) => ({ ...current, week_number: e.target.value }))}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Ngày bắt đầu</span>
              <input
                type="date"
                onChange={(e) => {
                  const start = fromInputDate(e.target.value)
                  setNewWeek((current) => ({
                    ...current,
                    start_date: start,
                    end_date: autoEndDate(e.target.value),
                  }))
                }}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Ngày kết thúc</span>
              <input
                type="date"
                value={toInputDate(newWeek.end_date)}
                onChange={(e) => {
                  setNewWeek((current) => ({
                    ...current,
                    end_date: fromInputDate(e.target.value),
                  }))
                }}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void createWeek()}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              Tạo tuần
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
