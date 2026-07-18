export type DutyPeriodWeek = {
  id: number
  week_number: number
  start_date: string
  end_date: string
  month_id?: number
  month_key?: string
  semester_key?: string
  closed_at?: string | null
  base_points?: number
}

export type DutyPeriodMonth = {
  id: number
  semester_id: number
  month_number: number
  month_key: string
  name: string
  semester_key: string
  closed_at?: string | null
  weeks: DutyPeriodWeek[]
}

export type DutyPeriodSemester = {
  id: number
  semester_number: number
  name: string
  semester_key: string
  closed_at?: string | null
  months: DutyPeriodMonth[]
}

export type DutyPeriodTree = {
  school_year: {
    id?: number | null
    year_key: string
  }
  semesters: DutyPeriodSemester[]
}

type Props = {
  tree: DutyPeriodTree | null
  semesterKey: string
  monthKey: string
  weekId: number | null
  onSemesterChange: (value: string) => void
  onMonthChange: (value: string) => void
  onWeekChange: (value: number | null) => void
  formatDate: (date: string) => string
}

export default function DutyPeriodSelector({
  tree,
  semesterKey,
  monthKey,
  weekId,
  onSemesterChange,
  onMonthChange,
  onWeekChange,
  formatDate,
}: Props) {
  const semesters = tree?.semesters || []
  const selectedSemester = semesters.find((item) => item.semester_key === semesterKey) || null
  const months = selectedSemester?.months || []
  const selectedMonth = months.find((item) => item.month_key === monthKey) || null
  const weeks = selectedMonth?.weeks || []

  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Chọn thời gian</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {tree?.school_year?.year_key ? `Năm học ${tree.school_year.year_key}` : "Dữ liệu theo năm học hiện tại"}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <div className="text-xs text-gray-500">Học kỳ</div>
          <select
            value={semesterKey}
            onChange={(e) => onSemesterChange(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
          >
            <option value="">Cả năm học</option>
            {semesters.map((semester) => (
              <option key={semester.semester_key} value={semester.semester_key}>
                {semester.name}
              </option>
            ))}
          </select>
        </div>

        {semesterKey ? (
          <div>
            <div className="text-xs text-gray-500">Tháng</div>
            <select
              value={monthKey}
              onChange={(e) => onMonthChange(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
            >
              <option value="">Tất cả tháng trong học kỳ</option>
              {months.map((month) => (
                <option key={month.month_key} value={month.month_key}>
                  {month.month_key}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {semesterKey && monthKey ? (
          <div>
            <div className="text-xs text-gray-500">Tuần</div>
            <select
              value={weekId ?? ""}
              onChange={(e) => onWeekChange(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full rounded-2xl border border-blue-100 bg-white px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
            >
              <option value="">Tất cả tuần trong tháng</option>
              {weeks.map((week) => (
                <option key={week.id} value={week.id}>
                  Tuần {week.week_number} ({formatDate(week.start_date)} - {formatDate(week.end_date)})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  )
}
