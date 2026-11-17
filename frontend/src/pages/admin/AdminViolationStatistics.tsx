import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"
import { api } from "../../api/api"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = { id: number; week_number: number; start_date: string; end_date: string; start_datetime?: string; end_datetime?: string }
type Item = Record<string, string | number>
type Statistics = {
  week: Week
  previous_week: (Week & { total_quantity: number }) | null
  summary: { total_quantity: number; affected_class_count: number; rule_count: number; signed_session_count: number; previous_delta: number | null }
  by_grade: Array<{ grade: number; total_quantity: number }>
  by_class: Array<{ class_name: string; total_quantity: number }>
  by_rule: Array<{ rule_id: number; rule_name: string; total_quantity: number }>
  by_day: Array<{ date: string; total_quantity: number }>
}

function formatDate(value: string) { const [year, month, day] = String(value || "").split("-"); return year && month && day ? `${day}/${month}/${year}` : value }

export default function AdminViolationStatistics() {
  usePageTitle("EDP | Thống kê vi phạm")
  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [statistics, setStatistics] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { void boot() }, [])
  async function boot() {
    setLoading(true)
    try {
      const list = (await api.get<Week[]>("/schedule/admin")).data || []
      setWeeks(list)
      const now = new Date()
      const current = list.find((week) => new Date((week.start_datetime || `${week.start_date}T00:00:00`).replace(" ", "T")) <= now && now <= new Date((week.end_datetime || `${week.end_date}T23:59:59`).replace(" ", "T")))
      const id = current?.id ?? list[0]?.id ?? null
      setWeekId(id)
      if (id) await load(id)
    } catch (error) { toast.error(getApiErrorMessage(error, "Không tải được danh sách tuần")) } finally { setLoading(false) }
  }
  async function load(id: number) {
    setLoading(true)
    try { setStatistics((await api.get<Statistics>(`/duty/admin/week/${id}/violation-statistics`)).data) }
    catch (error) { setStatistics(null); toast.error(getApiErrorMessage(error, "Không tải được thống kê vi phạm")) } finally { setLoading(false) }
  }
  async function exportExcel() {
    if (!weekId) return
    setExporting(true)
    try {
      const response = await api.get(`/duty/admin/week/${weekId}/violation-statistics/export`, { responseType: "blob" })
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
      const link = document.createElement("a")
      link.href = url; link.download = `thong_ke_vi_pham_tuan_${statistics?.week.week_number || weekId}.xlsx`
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
    } catch (error) { toast.error(getApiErrorMessage(error, "Không tải được file Excel")) } finally { setExporting(false) }
  }
  const topClasses = useMemo(() => (statistics?.by_class || []).filter((item) => item.total_quantity > 0).slice(0, 5), [statistics])
  const topRules = useMemo(() => (statistics?.by_rule || []).slice(0, 5), [statistics])
  const delta = statistics?.summary.previous_delta
  const comparison = delta == null ? "Chưa có tuần trước để đối chiếu" : delta === 0 ? "Không thay đổi so với tuần trước" : `${delta > 0 ? "+" : ""}${delta} lượt so với tuần trước`

  return <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
    <Navbar />
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
      <div className="text-sm text-gray-500 flex items-center gap-2"><Link to="/admin/dashboard" className="hover:text-[#2e77df]">Bảng điều khiển</Link><span>/</span><span className="font-medium text-gray-700">Thống kê vi phạm</span></div>
      <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6"><div className="flex flex-col sm:flex-row sm:items-end gap-3"><div className="min-w-0"><h1 className="text-xl font-semibold text-gray-900">Thống kê vi phạm nề nếp</h1><p className="mt-1 text-sm text-gray-600">Tổng hợp nhanh để theo dõi và sinh hoạt theo tuần.</p></div><div className="sm:ml-auto flex flex-col sm:flex-row gap-3"><select value={weekId ?? ""} onChange={(event) => { const id = Number(event.target.value); setWeekId(id); void load(id) }} className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]">{weeks.map((week) => <option key={week.id} value={week.id}>Tuần {week.week_number} ({formatDate(week.start_date)} - {formatDate(week.end_date)})</option>)}</select><button type="button" onClick={() => void exportExcel()} disabled={!weekId || exporting} className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{exporting ? "Đang xuất..." : "Xuất Excel"}</button></div></div></section>
      {loading ? <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6 text-sm text-gray-600">Đang tải dữ liệu...</section> : !statistics ? <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6 text-sm text-gray-600">Chưa có dữ liệu tuần.</section> : <>
        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6"><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="Tổng lượt vi phạm" value={statistics.summary.total_quantity} tone="text-red-600" /><Stat label="Lớp có phát sinh" value={statistics.summary.affected_class_count} tone="text-[#2e77df]" /><Stat label="Lỗi đã phát sinh" value={statistics.summary.rule_count} tone="text-amber-600" /><Stat label="Phiếu đã ký" value={statistics.summary.signed_session_count} tone="text-emerald-700" /></div><div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${delta != null && delta > 0 ? "bg-red-50 text-red-700" : "bg-blue-50 text-[#2e77df]"}`}>{comparison}</div></section>
        <section className="grid gap-4 lg:grid-cols-2"><GlassList title="Lớp cần lưu ý" subtitle="Số lượt vi phạm cao nhất trong tuần" items={topClasses as Item[]} label={(item) => String(item.class_name)} value={(item) => Number(item.total_quantity)} tone="text-red-600" /><GlassList title="Lỗi cần quán triệt" subtitle="Các lỗi xuất hiện nhiều nhất" items={topRules as Item[]} label={(item) => String(item.rule_name)} value={(item) => Number(item.total_quantity)} tone="text-amber-600" /></section>
        <section className="edp-glass-panel rounded-[32px] p-0 overflow-hidden"><div className="px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Theo khối và ngày</h2><p className="mt-1 text-xs text-gray-500">Dữ liệu chi tiết theo từng lớp và lỗi nằm trong file Excel.</p></div><div className="grid divide-y divide-blue-50 sm:grid-cols-2 sm:divide-x sm:divide-y-0"><MiniList title="Theo khối" items={statistics.by_grade as Item[]} label={(item) => `Khối ${item.grade}`} value={(item) => Number(item.total_quantity)} /><MiniList title="Theo ngày" items={statistics.by_day as Item[]} label={(item) => formatDate(String(item.date))} value={(item) => Number(item.total_quantity)} /></div></section>
      </>}
    </main><Footer />
  </div>
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-blue-50"><div className="text-[11px] text-gray-500">{label}</div><div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div></div> }
function GlassList({ title, subtitle, items, label, value, tone }: { title: string; subtitle: string; items: Item[]; label: (item: Item) => string; value: (item: Item) => number; tone: string }) { return <section className="edp-glass-panel rounded-[32px] p-0 overflow-hidden"><div className="px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">{title}</h2><p className="mt-1 text-xs text-gray-500">{subtitle}</p></div><div className="divide-y divide-blue-50">{items.map((item, index) => <div key={`${label(item)}-${index}`} className="flex items-center gap-3 px-5 py-3.5"><div className="w-7 text-sm font-semibold text-gray-400">#{index + 1}</div><div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{label(item)}</div><div className={`text-lg font-semibold ${tone}`}>{value(item)}</div></div>)}{!items.length && <div className="px-5 py-6 text-sm text-gray-600">Chưa có vi phạm chính thức.</div>}</div></section> }
function MiniList({ title, items, label, value }: { title: string; items: Item[]; label: (item: Item) => string; value: (item: Item) => number }) { return <div className="p-5"><h3 className="mb-3 text-xs font-semibold text-gray-500">{title}</h3><div className="space-y-2">{items.map((item, index) => <div className="flex justify-between gap-3 text-sm" key={`${label(item)}-${index}`}><span className="text-gray-700">{label(item)}</span><span className="font-semibold text-gray-900">{value(item)}</span></div>)}</div></div> }
