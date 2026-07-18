import { useEffect, useMemo, useState } from "react"
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

type Semester = {
  id: number
  school_year_id: number
  school_year_name: string
  semester_number: number
  name: string
  created_at?: string | null
}

type Month = {
  id: number
  semester_id: number
  semester_name: string
  semester_number: number
  month_number: number
  month_key: string
  name: string
  created_at?: string | null
}

const romanByNumber: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
}

function monthDateValue(monthKey: string) {
  const match = String(monthKey || "").match(/^(\d{2})\/(\d{4})$/)
  if (!match) return 0
  return Number(`${match[2]}${match[1]}`)
}

function isValidMonthKey(monthKey: string) {
  const match = String(monthKey || "").trim().match(/^(\d{2})\/(\d{4})$/)
  if (!match) return false
  const month = Number(match[1])
  return month >= 1 && month <= 12
}

export default function AdminTimeManagement() {
  usePageTitle("EDP | Quản lý thời gian")

  const [semesters, setSemesters] = useState<Semester[]>([])
  const [months, setMonths] = useState<Month[]>([])
  const [selectedSemesterId, setSelectedSemesterId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSemester, setSavingSemester] = useState(false)
  const [savingMonth, setSavingMonth] = useState(false)
  const [showSemesterModal, setShowSemesterModal] = useState(false)
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [newSemesterNumber, setNewSemesterNumber] = useState("1")
  const [newMonthKey, setNewMonthKey] = useState("09/2026")
  const [monthSemesterId, setMonthSemesterId] = useState("")
  const [editingSemesterId, setEditingSemesterId] = useState<number | null>(null)
  const [editingMonthId, setEditingMonthId] = useState<number | null>(null)

  const selectedSemester = useMemo(
    () => semesters.find((item) => item.id === selectedSemesterId) || null,
    [semesters, selectedSemesterId],
  )

  const monthsForSelectedSemester = useMemo(
    () =>
      months
        .filter((item) => item.semester_id === selectedSemesterId)
        .sort((a, b) => monthDateValue(a.month_key) - monthDateValue(b.month_key)),
    [months, selectedSemesterId],
  )

  useEffect(() => {
    void loadTime()
  }, [])

  async function loadTime(preferredSemesterId?: number) {
    try {
      setLoading(true)
      const res = await api.get("/schedule/admin/time")
      const nextSemesters: Semester[] = res.data.semesters || []
      const nextMonths: Month[] = res.data.months || []

      setSemesters(nextSemesters)
      setMonths(nextMonths)

      const semesterId =
        preferredSemesterId && nextSemesters.some((item) => item.id === preferredSemesterId)
          ? preferredSemesterId
          : selectedSemesterId && nextSemesters.some((item) => item.id === selectedSemesterId)
            ? selectedSemesterId
            : nextSemesters[nextSemesters.length - 1]?.id ?? nextSemesters[0]?.id ?? null

      setSelectedSemesterId(semesterId)
      setMonthSemesterId(semesterId ? String(semesterId) : "")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được cấu trúc thời gian")
    } finally {
      setLoading(false)
    }
  }

  function openCreateSemesterModal() {
    setNewSemesterNumber("1")
    setEditingSemesterId(null)
    setShowSemesterModal(true)
  }

  function openCreateMonthModal() {
    if (!semesters.length) {
      toast.error("Hãy tạo học kỳ trước")
      return
    }

    const defaultSemesterId = selectedSemesterId || semesters[semesters.length - 1]?.id
    setMonthSemesterId(defaultSemesterId ? String(defaultSemesterId) : "")
    setNewMonthKey("09/2026")
    setEditingMonthId(null)
    setShowMonthModal(true)
  }

  function openEditSemesterModal(semester: Semester) {
    setEditingSemesterId(semester.id)
    setNewSemesterNumber(String(semester.semester_number))
    setShowSemesterModal(true)
  }

  function openEditMonthModal(month: Month) {
    setEditingMonthId(month.id)
    setMonthSemesterId(String(month.semester_id))
    setNewMonthKey(month.month_key)
    setShowMonthModal(true)
  }

  async function createSemester() {
    const semesterNumber = Number(newSemesterNumber)
    if (!Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 9) {
      toast.error("Số học kỳ phải từ 1 đến 9")
      return
    }

    try {
      setSavingSemester(true)
      const res = editingSemesterId
        ? await api.put(`/schedule/admin/semesters/${editingSemesterId}`, {
            semester_number: semesterNumber,
          })
        : await api.post("/schedule/admin/semesters", {
            semester_number: semesterNumber,
          })

      setShowSemesterModal(false)
      const nextSemesterId = editingSemesterId || res.data.id
      setSelectedSemesterId(nextSemesterId)
      setMonthSemesterId(String(nextSemesterId))
      setEditingSemesterId(null)
      await loadTime(nextSemesterId)
      toast.success(editingSemesterId ? "Đã cập nhật học kỳ" : "Đã tạo học kỳ")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được học kỳ")
    } finally {
      setSavingSemester(false)
    }
  }

  async function deleteSemester(semester: Semester) {
    const confirmed = window.confirm(`Xóa ${semester.name}?`)
    if (!confirmed) return

    try {
      await api.delete(`/schedule/admin/semesters/${semester.id}`)
      const nextSelected = selectedSemesterId === semester.id ? undefined : selectedSemesterId || undefined
      await loadTime(nextSelected)
      toast.success("Đã xóa học kỳ")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được học kỳ")
    }
  }

  async function createMonth() {
    const semesterId = Number(monthSemesterId)
    const monthKey = newMonthKey.trim()

    if (!semesterId) {
      toast.error("Vui lòng chọn học kỳ")
      return
    }

    if (!isValidMonthKey(monthKey)) {
      toast.error("Tháng phải đúng định dạng MM/YYYY, ví dụ 09/2026")
      return
    }

    try {
      setSavingMonth(true)
      if (editingMonthId) {
        await api.put(`/schedule/admin/months/${editingMonthId}`, {
          semester_id: semesterId,
          month_key: monthKey,
        })
      } else {
        await api.post("/schedule/admin/months", {
          semester_id: semesterId,
          month_key: monthKey,
        })
      }

      setShowMonthModal(false)
      setEditingMonthId(null)
      setSelectedSemesterId(semesterId)
      await loadTime(semesterId)
      toast.success(editingMonthId ? "Đã cập nhật tháng" : "Đã tạo tháng")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được tháng")
    } finally {
      setSavingMonth(false)
    }
  }

  async function deleteMonth(month: Month) {
    const confirmed = window.confirm(`Xóa ${month.month_key}?`)
    if (!confirmed) return

    try {
      await api.delete(`/schedule/admin/months/${month.id}`)
      await loadTime(selectedSemesterId || undefined)
      toast.success("Đã xóa tháng")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được tháng")
    }
  }

  return (
    <AdminPageShell maxWidthClassName="max-w-6xl">
      <AdminBreadcrumb current="Quản lý thời gian" />

      <AdminHeroCard
        eyebrow="Thời gian"
        title="Quản lý Học kỳ và Tháng"
        description="Tạo học kỳ trước, sau đó tạo tháng trong học kỳ. Tuần được quản lý riêng ở màn Quản lý lịch trực."
        actions={
          <>
            <button
              type="button"
              onClick={openCreateMonthModal}
              className="min-h-11 rounded-[18px] border border-white/70 bg-white/72 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98]"
            >
              + Tạo tháng
            </button>
            <button
              type="button"
              onClick={openCreateSemesterModal}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              + Tạo học kỳ
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <AdminSectionCard className="h-fit">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Học kỳ</h2>
              <p className="mt-1 text-sm text-slate-500">Chọn học kỳ để xem các tháng bên trong.</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
              {semesters.length}
            </span>
          </div>

          <div className="mt-5 space-y-2">
            {loading ? (
              <div className="rounded-[22px] bg-white/70 p-4 text-sm text-slate-500">Đang tải học kỳ...</div>
            ) : semesters.length === 0 ? (
              <div className="rounded-[22px] bg-white/70 p-4 text-sm text-slate-500">
                Chưa có học kỳ. Hãy tạo học kỳ đầu tiên.
              </div>
            ) : (
              semesters.map((semester) => (
                <div
                  key={semester.id}
                  className={`w-full rounded-[22px] border px-4 py-3 text-left transition duration-200 active:scale-[0.99] ${
                    semester.id === selectedSemesterId
                      ? "border-[#2e77df]/40 bg-[#2e77df]/10 shadow-[0_14px_30px_rgba(46,119,223,0.12)]"
                      : "border-white/70 bg-white/72 hover:bg-white/90"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSemesterId(semester.id)
                      setMonthSemesterId(String(semester.id))
                    }}
                    className="w-full text-left"
                  >
                    <div className="font-semibold text-slate-900">{semester.name}</div>
                    <div className="mt-1 text-xs text-slate-500">Năm học {semester.school_year_name}</div>
                  </button>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditSemesterModal(semester)}
                      className="rounded-[14px] border border-white/70 bg-white/78 px-3 py-1.5 text-xs font-semibold text-slate-700 transition active:scale-[0.98]"
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSemester(semester)}
                      className="rounded-[14px] border border-rose-100 bg-white/78 px-3 py-1.5 text-xs font-semibold text-rose-600 transition active:scale-[0.98]"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </AdminSectionCard>

        <AdminSectionCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {selectedSemester ? `Tháng thuộc ${selectedSemester.name}` : "Danh sách tháng"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Nhập tháng theo MM/YYYY. Hệ thống không tự suy luận năm.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateMonthModal}
              className="min-h-10 rounded-[16px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.18)] transition duration-200 active:scale-[0.98] sm:ml-auto"
            >
              + Tạo tháng
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {!selectedSemester ? (
              <div className="rounded-[24px] bg-white/70 p-5 text-sm text-slate-500 md:col-span-2">
                Chọn hoặc tạo học kỳ để bắt đầu tạo tháng.
              </div>
            ) : monthsForSelectedSemester.length === 0 ? (
              <div className="rounded-[24px] bg-white/70 p-5 text-sm text-slate-500 md:col-span-2">
                Học kỳ này chưa có tháng.
              </div>
            ) : (
              monthsForSelectedSemester.map((month) => (
                <div
                  key={month.id}
                  className="rounded-[24px] border border-white/70 bg-white/76 p-5 shadow-[0_14px_28px_rgba(15,23,42,0.05)]"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2e77df]/70">
                    {month.name}
                  </div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{month.month_key}</div>
                  <div className="mt-2 text-sm text-slate-500">{month.semester_name}</div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditMonthModal(month)}
                      className="rounded-[14px] border border-white/70 bg-white/78 px-3 py-1.5 text-xs font-semibold text-slate-700 transition active:scale-[0.98]"
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteMonth(month)}
                      className="rounded-[14px] border border-rose-100 bg-white/78 px-3 py-1.5 text-xs font-semibold text-rose-600 transition active:scale-[0.98]"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </AdminSectionCard>
      </div>

      {showSemesterModal && (
        <ModalShell className="max-w-md border-white/70 bg-white/86 p-6 backdrop-blur-xl" onClose={() => setShowSemesterModal(false)}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {editingSemesterId ? "Sửa học kỳ" : "Tạo học kỳ"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">Nhập số từ 1 đến 9, backend sẽ lưu thành số La Mã.</p>
          </div>

          <label className="mt-5 block space-y-2">
            <span className="text-sm font-semibold text-slate-900">Số học kỳ</span>
            <input
              type="number"
              min={1}
              max={9}
              value={newSemesterNumber}
              onChange={(e) => setNewSemesterNumber(e.target.value)}
              className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              placeholder="2"
            />
            <span className="block text-xs text-slate-500">
              Sẽ lưu thành Học kỳ {romanByNumber[Number(newSemesterNumber)] || "..."}.
            </span>
          </label>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowSemesterModal(false)}
              disabled={savingSemester}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void createSemester()}
              disabled={savingSemester}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {savingSemester ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </ModalShell>
      )}

      {showMonthModal && (
        <ModalShell className="max-w-md border-white/70 bg-white/86 p-6 backdrop-blur-xl" onClose={() => setShowMonthModal(false)}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {editingMonthId ? "Sửa tháng" : "Tạo tháng"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Mặc định thuộc học kỳ đang chọn hoặc học kỳ vừa tạo gần nhất. Bạn vẫn có thể đổi nếu cần.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Tháng</span>
              <input
                value={newMonthKey}
                onChange={(e) => setNewMonthKey(e.target.value)}
                className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                placeholder="09/2026"
              />
              <span className="block text-xs text-slate-500">Đúng định dạng MM/YYYY. Không chấp nhận 9/2026.</span>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Thuộc học kỳ</span>
              <select
                value={monthSemesterId}
                onChange={(e) => setMonthSemesterId(e.target.value)}
                className="w-full rounded-[20px] border border-white/70 bg-white/84 px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Chọn học kỳ</option>
                {semesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowMonthModal(false)}
              disabled={savingMonth}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void createMonth()}
              disabled={savingMonth}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {savingMonth ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </ModalShell>
      )}
    </AdminPageShell>
  )
}
