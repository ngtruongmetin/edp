import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import EvidenceFilePreviewModal, { type EvidencePreviewFile } from "../../components/EvidenceFilePreviewModal"
import Footer from "../../components/Footer"
import ModalShell from "../../components/ModalShell"
import Navbar from "../../components/Navbar"
import { getApiErrorMessage } from "../../utils/getApiErrorMessage"
import { usePageTitle } from "../../utils/usePageTitle"

type EvidenceFile = {
  id: number
  file_name: string
  mime_type: string
  url: string
}

type Evidence = {
  id: number
  class_name: string
  student_name: string
  week_number?: number
  start_date: string
  end_date: string
  submitted_by: string
  submitted_at: string
  reviewed_by?: string | null
  reviewed_at?: string | null
  review_reason?: string | null
  note?: string | null
  status: "pending" | "approved" | "rejected"
  approved_exemption_count: number
  files?: EvidenceFile[]
  comparison?: Array<{
    date: string
    absence_type: string
    absence_count: number
    absence_exempted: number
    effective_absence: number
  }>
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}/${year}` : value
}

function statusLabel(status: Evidence["status"]) {
  if (status === "approved") return "Đã chấp nhận"
  if (status === "rejected") return "Đã từ chối"
  return "Chờ duyệt"
}

function statusClass(status: Evidence["status"]) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700"
  if (status === "rejected") return "bg-rose-50 text-rose-700"
  return "bg-amber-50 text-amber-800"
}

export default function AdminAbsenceEvidences() {
  usePageTitle("EDP | Quản lý minh chứng nghỉ học")
  const [status, setStatus] = useState("")
  const [evidences, setEvidences] = useState<Evidence[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Evidence | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [approvedDates, setApprovedDates] = useState<string[]>([])
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get<{ evidences: Evidence[] }>("/absence-evidences/admin", {
        params: status ? { status } : undefined,
      })
      setEvidences(response.data.evidences || [])
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tải danh sách minh chứng."))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(id: number) {
    try {
      setLoadingDetail(true)
      setPreviewIndex(null)
      const response = await api.get<{ evidence: Evidence }>(`/absence-evidences/admin/${id}`)
      setSelected(response.data.evidence)
      setApprovedDates((response.data.evidence.comparison || [])
        .filter((item) => item.effective_absence > 0)
        .map((item) => item.date))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tải chi tiết minh chứng."))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function review(action: "approved" | "rejected", reason = "") {
    if (!selected) return
    if (action === "approved" && approvedDates.length === 0) {
      toast.error("Chọn ít nhất một ngày có lỗi để miễn trừ.")
      return
    }
    if (action === "rejected" && !reason.trim()) {
      toast.error("Vui lòng nhập lý do từ chối.")
      return
    }
    try {
      setReviewing(true)
      const response = await api.post<{ evidence: Evidence }>(`/absence-evidences/admin/${selected.id}/review`, action === "approved"
        ? { action, approved_dates: approvedDates }
        : { action, review_reason: reason.trim() })
      setSelected(response.data.evidence)
      setEvidences((current) => current.map((item) => item.id === selected.id ? response.data.evidence : item))
      setApprovedDates([])
      setShowRejectModal(false)
      setRejectionReason("")
      toast.success(action === "approved" ? "Đã chấp nhận minh chứng." : "Đã từ chối minh chứng.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể xử lý minh chứng."))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-28 sm:px-6 sm:pb-8 lg:px-8">
        <nav className="flex items-center gap-2 text-sm text-slate-500" aria-label="Điều hướng đường dẫn">
          <Link to="/admin/dashboard" className="font-medium transition hover:text-[#2e77df]">Bảng điều khiển</Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Minh chứng nghỉ học</span>
        </nav>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2e77df]/70">Quản lý học sinh</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Minh chứng nghỉ học</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Đối chiếu số vắng có phép và ghi nhận số lượng được miễn trừ, không thay đổi dữ liệu Phiếu trực.</p>
            </div>
            <label className="block text-sm font-semibold text-slate-700">
              Trạng thái
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-2 min-h-11 w-full rounded-2xl border border-blue-100 bg-white px-4 text-sm font-medium text-slate-800 outline-none focus:border-[#2e77df] sm:w-52">
                <option value="">Tất cả trạng thái</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã chấp nhận</option>
                <option value="rejected">Đã từ chối</option>
              </select>
            </label>
          </div>
        </section>

        <section className="edp-glass-panel overflow-hidden rounded-[32px]">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Đang tải danh sách...</div>
          ) : evidences.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Chưa có minh chứng phù hợp.</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Lớp</th>
                      <th className="px-5 py-4 font-semibold">Học sinh</th>
                      <th className="px-5 py-4 font-semibold">Khoảng nghỉ</th>
                      <th className="px-5 py-4 font-semibold">Ngày gửi</th>
                      <th className="px-5 py-4 font-semibold">Người gửi</th>
                      <th className="px-5 py-4 font-semibold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {evidences.map((evidence) => (
                      <tr key={evidence.id} onClick={() => void openDetail(evidence.id)} className="cursor-pointer transition hover:bg-blue-50/50">
                        <td className="px-5 py-4 font-semibold text-slate-900">{evidence.class_name}</td>
                        <td className="px-5 py-4 text-slate-700">{evidence.student_name}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDate(evidence.start_date)} - {formatDate(evidence.end_date)}</td>
                        <td className="px-5 py-4 text-slate-600">{new Date(evidence.submitted_at).toLocaleString("vi-VN")}</td>
                        <td className="px-5 py-4 text-slate-600">{evidence.submitted_by}</td>
                        <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(evidence.status)}`}>{statusLabel(evidence.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-4 md:hidden">
                {evidences.map((evidence) => (
                  <button key={evidence.id} type="button" onClick={() => void openDetail(evidence.id)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition active:scale-[0.99]">
                    <div className="flex gap-3"><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{evidence.student_name}</div><div className="mt-1 text-xs text-slate-500">{evidence.class_name} · {formatDate(evidence.start_date)} - {formatDate(evidence.end_date)}</div><div className="mt-2 text-xs text-slate-500">{evidence.submitted_by}</div></div><span className={`h-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(evidence.status)}`}>{statusLabel(evidence.status)}</span></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      <Footer />

      {(selected || loadingDetail) && (
        <ModalShell className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto p-5 sm:p-7" onClose={loadingDetail || reviewing ? undefined : () => { setPreviewIndex(null); setSelected(null) }}>
          {loadingDetail || !selected ? (
            <div className="py-10 text-center text-sm text-slate-500">Đang tải chi tiết...</div>
          ) : (
            <div className="pr-10">
              <div className="flex flex-wrap items-center gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]/70">Lớp {selected.class_name}</p><h2 className="mt-2 text-xl font-semibold text-slate-900">{selected.student_name}</h2></div>
                <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(selected.status)}`}>{statusLabel(selected.status)}</span>
              </div>
              <dl className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Khoảng nghỉ</dt><dd className="mt-1 font-semibold text-slate-800">{formatDate(selected.start_date)} - {formatDate(selected.end_date)}</dd></div><div><dt className="text-slate-500">Người gửi</dt><dd className="mt-1 font-semibold text-slate-800">{selected.submitted_by}</dd></div><div><dt className="text-slate-500">Ngày gửi</dt><dd className="mt-1 font-semibold text-slate-800">{new Date(selected.submitted_at).toLocaleString("vi-VN")}</dd></div><div><dt className="text-slate-500">Đã miễn trừ</dt><dd className="mt-1 font-semibold text-emerald-700">{selected.approved_exemption_count || 0}</dd></div></dl>

              {selected.status === "rejected" && selected.review_reason && (
                <section className="mt-5">
                  <h3 className="text-sm font-semibold text-slate-900">Lý do từ chối</h3>
                  <p className="mt-2 rounded-2xl bg-rose-50 p-4 text-sm leading-6 text-rose-800">{selected.review_reason}</p>
                </section>
              )}

              {selected.note && <section className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Ghi chú</h3><p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{selected.note}</p></section>}
              <section className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Tệp minh chứng</h3><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{selected.files?.map((file, index) => file.mime_type.startsWith("image/") ? <button key={file.id} type="button" onClick={() => setPreviewIndex(index)} className="overflow-hidden rounded-2xl border border-slate-200 text-left transition hover:border-blue-200 active:scale-[0.98]"><img src={file.url} alt={file.file_name} className="h-28 w-full object-cover" /><span className="block truncate px-2 py-2 text-xs font-medium text-slate-600">{file.file_name}</span></button> : <button key={file.id} type="button" onClick={() => setPreviewIndex(index)} className="flex min-h-28 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 px-3 text-center text-xs font-semibold text-rose-700 transition active:scale-[0.98]">Xem tệp PDF</button>)}</div></section>
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-900">Đối chiếu Phiếu trực</h3>
                {selected.status === "pending" ? (
                  (selected.comparison || []).filter((item) => item.effective_absence > 0).length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {(selected.comparison || []).filter((item) => item.effective_absence > 0).map((item) => {
                        const checked = approvedDates.includes(item.date)
                        return (
                          <label key={item.date} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-blue-200">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setApprovedDates((current) => checked ? current.filter((date) => date !== item.date) : [...current, item.date])}
                              className="h-5 w-5 rounded border-slate-300 text-[#2e77df] focus:ring-[#2e77df]"
                            />
                            <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{formatDate(item.date)} - {item.absence_type}</span>
                            <span className="text-xs font-medium text-slate-500">Còn {item.effective_absence}</span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">Không tìm thấy lỗi Vắng có phép còn hiệu lực trong khoảng thời gian này.</p>
                  )
                ) : selected.comparison?.length ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-3 text-left font-semibold">Ngày</th><th className="px-3 py-3 text-right font-semibold">Vắng có phép</th><th className="px-3 py-3 text-right font-semibold">Miễn trừ</th><th className="px-3 py-3 text-right font-semibold">Còn hiệu lực</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">{selected.comparison.map((item) => <tr key={item.date}><td className="px-3 py-3 text-slate-700">{formatDate(item.date)}</td><td className="px-3 py-3 text-right font-semibold text-slate-800">{item.absence_count}</td><td className="px-3 py-3 text-right font-semibold text-emerald-700">{item.absence_exempted}</td><td className="px-3 py-3 text-right font-semibold text-slate-800">{item.effective_absence}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Không có lỗi Vắng có phép trong khoảng thời gian này.</p>
                )}
                {selected.status === "pending" && (
                  <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      disabled={reviewing}
                      onClick={() => { setRejectionReason(""); setShowRejectModal(true) }}
                      className="min-h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 disabled:opacity-60"
                    >
                      Từ chối
                    </button>
                    <button
                      type="button"
                      disabled={reviewing || approvedDates.length === 0}
                      onClick={() => void review("approved")}
                      className="min-h-11 rounded-2xl bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] disabled:opacity-60"
                    >
                      {reviewing ? "Đang xử lý..." : "Chấp nhận"}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </ModalShell>
      )}

      {showRejectModal && selected && (
        <ModalShell className="max-w-lg p-5 sm:p-6" onClose={reviewing ? undefined : () => setShowRejectModal(false)}>
          <h2 className="pr-10 text-lg font-semibold text-slate-900">Từ chối minh chứng</h2>
          <label className="mt-5 block text-sm font-semibold text-slate-800">
            Lý do từ chối
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder="Nhập lý do từ chối"
              className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={reviewing} onClick={() => setShowRejectModal(false)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60">Hủy</button>
            <button type="button" disabled={reviewing || !rejectionReason.trim()} onClick={() => void review("rejected", rejectionReason)} className="min-h-11 rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{reviewing ? "Đang lưu..." : "Từ chối"}</button>
          </div>
        </ModalShell>
      )}

      {selected?.files && previewIndex !== null && selected.files[previewIndex] && (
        <EvidenceFilePreviewModal files={selected.files as EvidencePreviewFile[]} initialIndex={previewIndex} onClose={() => setPreviewIndex(null)} />
      )}
    </div>
  )
}
