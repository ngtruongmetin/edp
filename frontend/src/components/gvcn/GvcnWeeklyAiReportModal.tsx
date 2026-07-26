import AssistantMarkdown from "../ai/AssistantMarkdown"
import ModalShell from "../ModalShell"
import type { GvcnAiReport } from "../../services/gvcnAiAssistant"

type Props = {
  open: boolean
  report: GvcnAiReport | null
  loading: boolean
  regenerating: boolean
  error: string
  weekNumber: number | null
  onClose: () => void
  onRegenerate: () => void
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function GvcnWeeklyAiReportModal({
  open,
  report,
  loading,
  regenerating,
  error,
  weekNumber,
  onClose,
  onRegenerate,
}: Props) {
  if (!open) return null

  return (
    <ModalShell
      className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col overflow-hidden rounded-[26px] p-0"
      onClose={loading || regenerating ? undefined : onClose}
    >
      <div className="border-b border-slate-100 px-5 py-5 pr-16 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#2e77df]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" />
              <path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" />
            </svg>
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Phân tích nề nếp bằng AI</h2>
            <p className="mt-0.5 text-sm text-slate-500">{weekNumber ? `Báo cáo tuần ${weekNumber}` : "Báo cáo tuần"}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-blue-100 border-t-[#2e77df]" aria-label="Đang phân tích" />
            <p className="mt-4 text-sm font-medium text-slate-800">AI đang phân tích dữ liệu nề nếp</p>
            <p className="mt-1 text-sm text-slate-500">Quá trình này có thể mất ít phút.</p>
          </div>
        ) : error ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-red-700">Không thể tạo báo cáo</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{error}</p>
            <button type="button" onClick={onRegenerate} className="mt-5 rounded-xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2468c8]">
              Thử lại
            </button>
          </div>
        ) : report ? (
          <AssistantMarkdown content={report.content} />
        ) : null}
      </div>

      {report && !loading && !error ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs leading-5 text-slate-500">
            {report.cached ? "Báo cáo đã lưu" : "Báo cáo vừa được phân tích"}
            {report.updatedAt ? ` lúc ${formatTimestamp(report.updatedAt)}` : ""}
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-blue-200 px-4 text-sm font-semibold text-[#2e77df] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {regenerating ? "Đang phân tích lại..." : "Phân tích lại"}
          </button>
        </div>
      ) : null}
    </ModalShell>
  )
}
