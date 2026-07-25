import { useEffect, useMemo, useState } from "react"
import * as Slider from "@radix-ui/react-slider"
import toast from "react-hot-toast"

import { api } from "../api/api"
import EvidenceFilePreviewModal, { type EvidencePreviewFile } from "./EvidenceFilePreviewModal"
import ModalShell from "./ModalShell"
import { getApiErrorMessage } from "../utils/getApiErrorMessage"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

type EvidenceFile = {
  id?: number
  file_name: string
  mime_type?: string
  url?: string
  type?: string
  data?: string
}

type Evidence = {
  id: number
  student_name: string
  start_date: string
  end_date: string
  submitted_at: string
  status: "pending" | "approved" | "rejected"
  approved_exemption_count: number
  review_reason?: string | null
  files: EvidenceFile[]
}

type Props = {
  week: Week | null
  disabled?: boolean
}

const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"])

function formatDate(date: string) {
  const [year, month, day] = date.split("-")
  return year && month && day ? `${day}/${month}/${year}` : date
}

function datesInWeek(startDate: string, endDate: string) {
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (current <= end) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, "0")
    const day = String(current.getDate()).padStart(2, "0")
    dates.push(`${year}-${month}-${day}`)
    current.setDate(current.getDate() + 1)
  }
  return dates
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

async function readFile(file: File): Promise<EvidenceFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ file_name: file.name, type: file.type, data: String(reader.result || "") })
    reader.onerror = () => reject(new Error("Tải tệp thất bại."))
    reader.readAsDataURL(file)
  })
}

export default function AbsenceEvidencePanel({ week, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [studentName, setStudentName] = useState("")
  const [startIndex, setStartIndex] = useState(0)
  const [endIndex, setEndIndex] = useState(0)
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<EvidenceFile[]>([])
  const [evidences, setEvidences] = useState<Evidence[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Evidence | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewFiles, setPreviewFiles] = useState<EvidencePreviewFile[]>([])

  const dates = useMemo(
    () => (week ? datesInWeek(week.start_date, week.end_date) : []),
    [week],
  )
  useEffect(() => {
    setStartIndex(0)
    setEndIndex(Math.max(0, dates.length - 1))
    setStudentName("")
    setNote("")
    setFiles([])
  }, [week?.id, dates.length])

  async function loadHistory() {
    if (!week) return
    try {
      setLoadingHistory(true)
      const response = await api.get<{ evidences: Evidence[] }>("/absence-evidences/my", {
        params: { week_id: week.id },
      })
      setEvidences(response.data.evidences || [])
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tải danh sách minh chứng."))
    } finally {
      setLoadingHistory(false)
    }
  }

  async function openPanel() {
    if (!week || disabled) return
    setOpen(true)
    await loadHistory()
  }

  function openPreview(filesToPreview: EvidenceFile[], initialFileIndex: number) {
    const availableFiles = filesToPreview.filter((file): file is EvidencePreviewFile => Boolean(file.url))
    const selectedFile = filesToPreview[initialFileIndex]
    const selectedIndex = availableFiles.findIndex((file) => file.id === selectedFile?.id)
    if (selectedIndex < 0) return

    setPreviewFiles(availableFiles)
    setPreviewIndex(selectedIndex)
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return
    const incoming = Array.from(fileList)
    if (files.length + incoming.length > 5) {
      toast.error("Bạn chỉ được tải tối đa 5 tệp.")
      return
    }
    if (incoming.some((file) => !allowedTypes.has(file.type))) {
      toast.error("Chỉ hỗ trợ ảnh JPG, JPEG, PNG hoặc tệp PDF.")
      return
    }
    if (incoming.some((file) => file.size > 8 * 1024 * 1024)) {
      toast.error("Mỗi tệp không được vượt quá 8 MB.")
      return
    }

    try {
      const uploadedFiles = await Promise.all(incoming.map(readFile))
      setFiles((current) => [...current, ...uploadedFiles])
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tải tệp thất bại."))
    }
  }

  async function submit() {
    if (!week || disabled) return
    if (!studentName.trim()) {
      toast.error("Vui lòng nhập tên học sinh.")
      return
    }
    if (!files.length) {
      toast.error("Vui lòng tải ít nhất một tệp minh chứng.")
      return
    }

    try {
      setSubmitting(true)
      const response = await api.post<{ evidence: Evidence }>("/absence-evidences", {
        week_id: week.id,
        student_name: studentName.trim(),
        start_date: dates[startIndex],
        end_date: dates[endIndex],
        note,
        files: files.map((file) => ({ name: file.file_name, type: file.type, data: file.data })),
      })
      setEvidences((current) => [response.data.evidence, ...current])
      setStudentName("")
      setStartIndex(0)
      setEndIndex(Math.max(0, dates.length - 1))
      setNote("")
      setFiles([])
      toast.success("Đã gửi minh chứng thành công.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể gửi minh chứng."))
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteEvidence() {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      await api.delete(`/absence-evidences/${deleteTarget.id}`)
      setEvidences((current) => current.filter((evidence) => evidence.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success("Đã xóa minh chứng.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể xóa minh chứng."))
    } finally {
      setDeleting(false)
    }
  }

  if (!week) return null

  return (
    <>
      <button
        type="button"
        onClick={() => void openPanel()}
        disabled={disabled}
        className="min-h-12 w-full rounded-2xl bg-[#2e77df] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition hover:bg-[#245fc0] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Minh chứng nghỉ học
      </button>

      {open && (
        <ModalShell className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto p-5 sm:p-7" onClose={() => setOpen(false)}>
          <div className="pr-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]/70">Tuần {week.week_number}</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Gửi minh chứng nghỉ học</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Mỗi lần gửi chỉ đại diện cho một học sinh.
            </p>
          </div>

          <div className="mt-6 space-y-5">
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Học sinh</span>
              <input
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                maxLength={160}
                placeholder="Nhập họ và tên học sinh"
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <section>
              <div className="text-sm font-semibold text-slate-800">Khoảng nghỉ</div>
              <div className="mt-1 text-lg font-semibold text-[#1d4ed8]">{formatDate(dates[startIndex])} → {formatDate(dates[endIndex])}</div>
              <div className="mt-4 grid grid-cols-7 gap-1 text-center">
                {dates.map((date, index) => {
                  const active = index >= startIndex && index <= endIndex
                  return (
                    <div key={date} className={`rounded-xl px-1 py-2 text-xs font-semibold ${active ? "bg-[#eff6ff] text-[#2e77df]" : "bg-slate-50 text-slate-500"}`}>
                      {date.slice(8, 10)}
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                <Slider.Root
                  min={0}
                  max={Math.max(0, dates.length - 1)}
                  step={1}
                  minStepsBetweenThumbs={0}
                  preserveThumbOrder
                  value={[startIndex, endIndex]}
                  onValueChange={([nextStart, nextEnd]) => {
                    setStartIndex(nextStart)
                    setEndIndex(nextEnd)
                  }}
                  className="relative flex h-12 w-full touch-none select-none items-center"
                  aria-label="Khoảng nghỉ"
                >
                  <Slider.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-blue-100">
                    <Slider.Range className="absolute h-full rounded-full bg-[#2e77df]" />
                  </Slider.Track>
                  <Slider.Thumb
                    className="block h-5 w-5 rounded-full border-4 border-white bg-[#2e77df] shadow-[0_4px_12px_rgba(46,119,223,0.36)] outline-none transition focus-visible:ring-4 focus-visible:ring-blue-200"
                    aria-label="Ngày bắt đầu khoảng nghỉ"
                  />
                  <Slider.Thumb
                    className="block h-5 w-5 rounded-full border-4 border-white bg-[#2e77df] shadow-[0_4px_12px_rgba(46,119,223,0.36)] outline-none transition focus-visible:ring-4 focus-visible:ring-blue-200"
                    aria-label="Ngày kết thúc khoảng nghỉ"
                  />
                </Slider.Root>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold text-slate-800">Minh chứng</div>
                <div className="ml-auto text-xs text-slate-500">{files.length}/5 tệp</div>
              </div>
              <label className="mt-3 flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-[#2e77df]/40 bg-blue-50/50 px-4 text-sm font-semibold text-[#2e77df] transition hover:bg-blue-50">
                Chọn ảnh hoặc tệp PDF
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    void addFiles(event.target.files)
                    event.currentTarget.value = ""
                  }}
                />
              </label>
              {files.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {files.map((file, index) => (
                    <div key={`${file.file_name}-${index}`} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                      {file.type?.startsWith("image/") ? (
                        <img src={file.data} alt={`Minh chứng ${index + 1}`} className="h-24 w-full rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-xl bg-rose-50 px-2 text-center text-xs font-semibold text-rose-700">Tệp PDF</div>
                      )}
                      <div className="mt-2 truncate text-xs font-medium text-slate-600">{file.file_name}</div>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-600 shadow-sm"
                        aria-label={`Xóa ${file.file_name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Ghi chú</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Có thể để trống"
                className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 outline-none transition focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || disabled}
              className="min-h-14 w-full rounded-2xl bg-[#2e77df] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Đang gửi..." : "Gửi minh chứng"}
            </button>
          </div>

          <section className="mt-8 border-t border-slate-200 pt-6">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-slate-900">Minh chứng đã gửi trong tuần</h3>
              <button type="button" onClick={() => void loadHistory()} className="ml-auto text-sm font-semibold text-[#2e77df]">Tải lại</button>
            </div>
            {loadingHistory ? (
              <div className="mt-4 text-sm text-slate-500">Đang tải danh sách...</div>
            ) : evidences.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">Chưa có minh chứng nào trong tuần này.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {evidences.map((evidence) => (
                  <article key={evidence.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{evidence.student_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(evidence.start_date)} - {formatDate(evidence.end_date)} · Gửi {new Date(evidence.submitted_at).toLocaleString("vi-VN")}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(evidence.status)}`}>{statusLabel(evidence.status)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {evidence.files.map((file, index) => (
                        <button key={`${file.id}-${index}`} type="button" onClick={() => openPreview(evidence.files, index)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-[#2e77df] transition active:scale-[0.98]">
                          {file.mime_type === "application/pdf" ? "Xem PDF" : "Xem ảnh"}
                        </button>
                      ))}
                    </div>
                    {evidence.status === "rejected" && evidence.review_reason && (
                      <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                        <span className="font-semibold">Lý do từ chối: </span>{evidence.review_reason}
                      </div>
                    )}
                    {(evidence.status === "pending" || evidence.status === "rejected") && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(evidence)}
                        className="mt-3 text-xs font-semibold text-rose-700 transition hover:text-rose-800"
                      >
                        Xóa minh chứng
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </ModalShell>
      )}

      {previewIndex !== null && previewFiles[previewIndex] && (
        <EvidenceFilePreviewModal files={previewFiles} initialIndex={previewIndex} onClose={() => { setPreviewIndex(null); setPreviewFiles([]) }} />
      )}

      {deleteTarget && (
        <ModalShell className="max-w-md p-5 sm:p-6" onClose={deleting ? undefined : () => setDeleteTarget(null)}>
          <h2 className="pr-10 text-lg font-semibold text-slate-900">Xóa minh chứng?</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Nếu xóa, minh chứng sẽ bị xóa vĩnh viễn.</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60">Hủy</button>
            <button type="button" disabled={deleting} onClick={() => void deleteEvidence()} className="min-h-11 rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{deleting ? "Đang xóa..." : "Xóa"}</button>
          </div>
        </ModalShell>
      )}
    </>
  )
}
