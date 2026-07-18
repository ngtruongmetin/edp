type PeriodSummaryRow = {
  class_name: string
  plus_points?: number
  minus_points?: number
  total_score?: number
  score?: number
  rank?: number
  note?: string
}

export type DutyPeriodSummary = {
  period_type: "week" | "month" | "semester" | "year"
  period_key: string
  closed_at: string | null
  ranking?: PeriodSummaryRow[]
  my_summary?: PeriodSummaryRow | null
  stats?: {
    class_count?: number
    week_count?: number
    month_count?: number
    semester_count?: number
    my_rank?: number | null
  }
}

type Props = {
  title: string
  summary: DutyPeriodSummary | null
  loading: boolean
  className?: string
}

function periodLabel(type?: string) {
  if (type === "month") return "tháng"
  if (type === "semester") return "học kỳ"
  if (type === "year") return "năm học"
  return "tuần"
}

function formatScore(value: unknown) {
  const number = Number(value || 0)
  return number > 0 ? `+${number}` : String(number)
}

function rowTotal(row?: PeriodSummaryRow | null) {
  return Number(row?.total_score ?? row?.score ?? 0)
}

export default function DutyPeriodSummaryCard({
  title,
  summary,
  loading,
  className,
}: Props) {
  const label = periodLabel(summary?.period_type)
  const mine = summary?.my_summary || null
  const ranking = summary?.ranking || []

  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {summary?.closed_at ? "Đã tổng kết" : "Dữ liệu tạm tính theo dữ liệu hiện tại"}
          </div>
        </div>
        {mine?.rank ? (
          <div className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Hạng #{mine.rank}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
      ) : !summary ? (
        <div className="mt-3 text-sm text-gray-600">Chưa có dữ liệu tổng kết.</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-[11px] text-gray-500">Điểm cộng</div>
              <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">
                {formatScore(mine?.plus_points)}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-[11px] text-gray-500">Điểm trừ</div>
              <div className="mt-0.5 text-sm font-semibold text-red-600">
                {Number(mine?.minus_points || 0) > 0 ? `-${mine?.minus_points}` : "0"}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-[11px] text-gray-500">Tổng điểm {label}</div>
              <div className="mt-0.5 text-sm font-semibold text-gray-900">
                {formatScore(rowTotal(mine))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-sm font-semibold text-gray-900">Thống kê {label}</div>
            <div className="mt-1 text-xs text-gray-600">
              {summary.stats?.class_count || 0} lớp trong khối
              {summary.stats?.week_count ? ` • ${summary.stats.week_count} tuần` : ""}
              {summary.stats?.month_count ? ` • ${summary.stats.month_count} tháng` : ""}
              {summary.stats?.semester_count ? ` • ${summary.stats.semester_count} học kỳ` : ""}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-900">Xếp hạng {label} (theo khối)</div>
            {ranking.length === 0 ? (
              <div className="mt-2 text-sm text-gray-600">Chưa có dữ liệu xếp hạng.</div>
            ) : (
              <div className="mt-2 space-y-2">
                {ranking.map((row, index) => {
                  const rank = Number(row.rank || 0) > 0 ? Number(row.rank) : index + 1
                  const active = row.class_name === className
                  return (
                    <div
                      key={`${row.class_name}-${index}`}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                        active ? "border-emerald-200 bg-emerald-50" : "border-blue-100 bg-white"
                      }`}
                    >
                      <div className="w-8 text-sm font-semibold text-gray-500">#{rank}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">{row.class_name}</div>
                        {row.note ? <div className="text-xs font-semibold text-amber-700">{row.note}</div> : null}
                      </div>
                      <div className="text-[15px] font-semibold text-gray-900">
                        {formatScore(rowTotal(row))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
