import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../api/api"
import { useAuth } from "../auth/AuthContext"
import EvidenceFilePreviewModal, { type EvidencePreviewFile } from "../components/EvidenceFilePreviewModal"
import Footer from "../components/Footer"
import ModalShell from "../components/ModalShell"
import Navbar from "../components/Navbar"
import { getApiErrorMessage } from "../utils/getApiErrorMessage"
import { getDashboardPath } from "../utils/authRoutes"
import { usePageTitle } from "../utils/usePageTitle"

type SupportRole = "admin" | "gvcn" | "ban_can_su" | "co_do"
type RequestType = "duty_complaint" | "system_bug" | "suggestion" | "usage_support" | "other"
type TicketStatus = "in_progress" | "resolved"

type Attachment = EvidencePreviewFile & { id: number; sort_order: number }

type Message = {
  id: number
  sender_role: SupportRole
  sender_class_id: number | null
  sender_label: string
  body: string
  created_at: string
  attachments: Attachment[]
}

type Ticket = {
  id: number
  creator_role: Exclude<SupportRole, "admin">
  creator_class_id: number
  creator_class_name: string
  title: string
  request_type: RequestType
  status: TicketStatus
  linked_week_id: number | null
  linked_duty_session_id: number | null
  linked_week_number?: number | null
  linked_duty_date?: string | null
  linked_red_class?: string | null
  linked_duty_class?: string | null
  created_at: string
  updated_at: string
  has_new_response?: boolean
  messages?: Message[]
}

type Week = { id: number; week_number: number; start_date: string; end_date: string }
type DutySession = { id: number; week_id: number; date: string; red_class: string; duty_class: string; status: string }
type SchoolClass = { id: number; name: string; grade: number }
type PendingFile = { name: string; type: string; data: string }

const requestTypeLabels: Record<RequestType, string> = {
  duty_complaint: "Khiếu nại phiếu trực",
  system_bug: "Báo lỗi hệ thống",
  suggestion: "Góp ý",
  usage_support: "Hỗ trợ sử dụng",
  other: "Khác",
}

const statusLabels: Record<TicketStatus, string> = {
  in_progress: "Đang xử lý",
  resolved: "Đã xử lý",
}

function statusClass(status: TicketStatus) {
  return status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-[#2e77df]"
}

function roleLabel(role: SupportRole) {
  const labels: Record<SupportRole, string> = {
    admin: "Quản trị viên",
    gvcn: "Giáo viên chủ nhiệm",
    ban_can_su: "Ban cán sự",
    co_do: "Cờ đỏ",
  }
  return labels[role]
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}/${year}` : value
}

function isAttachment(file: Attachment | PendingFile): file is Attachment {
  return "id" in file
}

function fileIcon(file: Attachment | PendingFile) {
  return (isAttachment(file) ? file.mime_type : file.type) === "application/pdf" ? "PDF" : "Ảnh"
}

function fileName(file: Attachment | PendingFile) {
  return isAttachment(file) ? file.file_name : file.name
}

async function readFiles(files: FileList | null): Promise<PendingFile[]> {
  const selected = Array.from(files || [])
  if (selected.length > 5) throw new Error("Chỉ được chọn tối đa 5 tệp.")
  return Promise.all(selected.map(async (file) => {
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      throw new Error("Chỉ hỗ trợ tệp JPG, JPEG, PNG hoặc PDF.")
    }
    if (file.size > 8 * 1024 * 1024) throw new Error("Mỗi tệp không được vượt quá 8 MB.")
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ""))
      reader.onerror = () => reject(new Error(`Không thể đọc tệp ${file.name}.`))
      reader.readAsDataURL(file)
    })
    return { name: file.name, type: file.type, data }
  }))
}

function FileChips({ files, onPreview, onRemove }: {
  files: Array<Attachment | PendingFile>
  onPreview?: (index: number) => void
  onRemove?: (index: number) => void
}) {
  if (!files.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <div key={isAttachment(file) ? file.id : `${file.name}-${index}`} className="flex min-h-10 max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
          <button type="button" onClick={() => onPreview?.(index)} className="max-w-[13rem] truncate text-left hover:text-[#2e77df] disabled:cursor-default" disabled={!onPreview}>
            <span className="mr-1 font-semibold text-[#2e77df]">{fileIcon(file)}</span>{fileName(file)}
          </button>
          {onRemove && <button type="button" onClick={() => onRemove(index)} className="rounded-md px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Bỏ ${fileName(file)}`}>x</button>}
        </div>
      ))}
    </div>
  )
}

export default function SupportCenter() {
  usePageTitle("EDP | Trung tâm hỗ trợ")
  const { user, isOffline } = useAuth()
  const isAdmin = user?.role === "admin"
  const canCreate = user?.role === "gvcn" || user?.role === "ban_can_su" || user?.role === "co_do"
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [weeks, setWeeks] = useState<Week[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [previewFiles, setPreviewFiles] = useState<Attachment[] | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [classFilter, setClassFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const loadTickets = useCallback(async () => {
    if (!user || isOffline) return
    try {
      setLoading(true)
      const response = isAdmin
        ? await api.get<{ tickets: Ticket[] }>("/support/admin", { params: {
          search: search.trim() || undefined,
          role: roleFilter || undefined,
          class_id: classFilter || undefined,
          request_type: typeFilter || undefined,
          status: statusFilter || undefined,
        } })
        : await api.get<{ tickets: Ticket[] }>("/support/my")
      setTickets(response.data.tickets || [])
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tải yêu cầu hỗ trợ."))
    } finally {
      setLoading(false)
    }
  }, [classFilter, isAdmin, isOffline, roleFilter, search, statusFilter, typeFilter, user])

  useEffect(() => {
    if (!user || isOffline) return
    void api.get<{ weeks: Week[]; classes?: SchoolClass[] }>("/support/meta")
      .then((response) => {
        setWeeks(response.data.weeks || [])
        setClasses(response.data.classes || [])
      })
      .catch(() => toast.error("Không thể tải dữ liệu của Trung tâm hỗ trợ."))
  }, [isOffline, user])

  useEffect(() => {
    if (isOffline) {
      setLoading(false)
      return
    }
    const debounce = window.setTimeout(() => void loadTickets(), isAdmin ? 220 : 0)
    return () => window.clearTimeout(debounce)
  }, [isAdmin, isOffline, loadTickets])

  async function openTicket(id: number) {
    try {
      setLoadingDetail(true)
      setPreviewFiles(null)
      const response = await api.get<{ ticket: Ticket }>(`/support/${id}`)
      setSelected(response.data.ticket)
      window.dispatchEvent(new Event("support-notifications-read"))
      setTickets((current) => current.map((ticket) => ticket.id === id ? { ...ticket, has_new_response: false } : ticket))
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tải hội thoại hỗ trợ."))
    } finally {
      setLoadingDetail(false)
    }
  }

  const shownTickets = useMemo(() => {
    if (isAdmin) return tickets
    const keyword = search.trim().toLocaleLowerCase("vi")
    return keyword ? tickets.filter((ticket) => ticket.title.toLocaleLowerCase("vi").includes(keyword)) : tickets
  }, [isAdmin, search, tickets])

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-28 sm:px-6 sm:pb-8 lg:px-8">
        <nav className="flex items-center gap-2 text-sm text-slate-500" aria-label="Điều hướng đường dẫn">
          <Link to={getDashboardPath(user.role)} className="font-medium transition hover:text-[#2e77df]">Bảng điều khiển</Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Trung tâm hỗ trợ</span>
        </nav>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2e77df]/70">Hỗ trợ EDP</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">Trung tâm hỗ trợ</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {isAdmin ? "Theo dõi, phản hồi và phân loại yêu cầu từ các lớp." : "Gửi khiếu nại, báo lỗi hoặc trao đổi trực tiếp với Quản trị viên."}
              </p>
            </div>
            {canCreate && <button type="button" onClick={() => setCreateOpen(true)} disabled={isOffline} className="min-h-12 rounded-2xl bg-[#2e77df] px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition hover:bg-[#245fc0] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">Tạo yêu cầu hỗ trợ</button>}
          </div>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="block lg:col-span-2">
              <span className="sr-only">Tìm kiếm</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isAdmin ? "Tìm theo tiêu đề hoặc lớp" : "Tìm theo tiêu đề"} className="min-h-11 w-full rounded-2xl border border-blue-100 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-4 focus:ring-blue-100" />
            </label>
            {isAdmin && <>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="min-h-11 rounded-2xl border border-blue-100 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2e77df]">
                <option value="">Tất cả vai trò</option>
                <option value="gvcn">Giáo viên chủ nhiệm</option>
                <option value="ban_can_su">Ban cán sự</option>
                <option value="co_do">Cờ đỏ</option>
              </select>
              <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="min-h-11 rounded-2xl border border-blue-100 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2e77df]">
                <option value="">Tất cả lớp</option>
                {classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}
              </select>
            </>}
            {isAdmin && <>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="min-h-11 rounded-2xl border border-blue-100 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2e77df]">
                <option value="">Tất cả loại</option>
                {Object.entries(requestTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-h-11 rounded-2xl border border-blue-100 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2e77df]">
                <option value="">Tất cả trạng thái</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </>}
          </div>
        </section>

        <section className="edp-glass-panel overflow-hidden rounded-[32px]">
          {loading ? <div className="p-8 text-sm text-slate-500">Đang tải yêu cầu hỗ trợ...</div> : shownTickets.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-base font-semibold text-slate-700">Chưa có yêu cầu hỗ trợ</p>
              <p className="mt-2 text-sm text-slate-500">{canCreate ? "Khi cần trao đổi, hãy tạo yêu cầu mới tại đây." : "Danh sách sẽ xuất hiện khi có yêu cầu từ người dùng."}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {shownTickets.map((ticket) => (
                <button key={ticket.id} type="button" onClick={() => void openTicket(ticket.id)} className="w-full px-4 py-4 text-left transition hover:bg-blue-50/50 active:bg-blue-50 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-slate-900">{ticket.title}</span>
                        {ticket.has_new_response && <span className="rounded-full bg-[#2e77df] px-2 py-0.5 text-[11px] font-semibold text-white">Phản hồi mới</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{requestTypeLabels[ticket.request_type]}</span>
                        {isAdmin && <span>{roleLabel(ticket.creator_role)} - lớp {ticket.creator_class_name}</span>}
                        <span>{formatDateTime(ticket.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(ticket.status)}`}>{statusLabels[ticket.status]}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />

      {createOpen && <CreateTicketModal weeks={weeks} isOffline={isOffline} onClose={() => setCreateOpen(false)} onCreated={(ticket) => {
        setTickets((current) => [ticket, ...current])
        setCreateOpen(false)
        void openTicket(ticket.id)
      }} />}

      {(selected || loadingDetail) && <TicketModal ticket={selected} loading={loadingDetail} currentRole={user.role as SupportRole} currentClassId={user.class_id} isOffline={isOffline} onClose={() => { setSelected(null); setLoadingDetail(false) }} onTicketUpdated={(ticket) => {
        setSelected(ticket)
        setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, ...ticket } : item))
      }} onPreview={(files, index) => { setPreviewFiles(files); setPreviewIndex(index) }} />}

      {previewFiles && <EvidenceFilePreviewModal files={previewFiles} initialIndex={previewIndex} onClose={() => setPreviewFiles(null)} />}
    </div>
  )
}

function CreateTicketModal({ weeks, isOffline, onClose, onCreated }: {
  weeks: Week[]
  isOffline: boolean
  onClose: () => void
  onCreated: (ticket: Ticket) => void
}) {
  const [title, setTitle] = useState("")
  const [requestType, setRequestType] = useState<RequestType>("duty_complaint")
  const [body, setBody] = useState("")
  const [weekId, setWeekId] = useState("")
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [sessionId, setSessionId] = useState("")
  const [files, setFiles] = useState<PendingFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (requestType !== "duty_complaint" || !weekId) {
      setSessions([])
      setSessionId("")
      return
    }
    let active = true
    void api.get<{ sessions: DutySession[] }>("/support/duty-sessions", { params: { week_id: weekId } })
      .then((response) => { if (active) setSessions(response.data.sessions || []) })
      .catch((error) => toast.error(getApiErrorMessage(error, "Không thể tải Phiếu trực.")))
    return () => { active = false }
  }, [requestType, weekId])

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      setFiles(await readFiles(event.target.files))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đọc tệp.")
    } finally {
      event.target.value = ""
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (isOffline) return toast.error("Chức năng này cần kết nối mạng.")
    try {
      setSubmitting(true)
      const response = await api.post<{ ticket: Ticket }>("/support", {
        title,
        request_type: requestType,
        body,
        linked_week_id: requestType === "duty_complaint" ? Number(weekId) || undefined : undefined,
        linked_duty_session_id: requestType === "duty_complaint" ? Number(sessionId) || undefined : undefined,
        files,
      })
      toast.success("Đã gửi yêu cầu hỗ trợ.")
      onCreated(response.data.ticket)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể gửi yêu cầu hỗ trợ."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell className="max-w-2xl overflow-hidden rounded-[30px]">
      <form onSubmit={(event) => void submit(event)} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-7">
        <div className="pr-10"><h2 className="text-xl font-semibold text-slate-900">Tạo yêu cầu hỗ trợ</h2><p className="mt-1 text-sm text-slate-500">Thông tin sẽ được lưu thành một cuộc hội thoại với Quản trị viên.</p></div>
        <div className="mt-6 grid gap-4">
          <label className="text-sm font-semibold text-slate-700">Tiêu đề<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-[#2e77df] focus:ring-4 focus:ring-blue-100" /></label>
          <label className="text-sm font-semibold text-slate-700">Loại yêu cầu<select value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-[#2e77df]">{Object.entries(requestTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {requestType === "duty_complaint" && <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">Tuần<select required value={weekId} onChange={(event) => setWeekId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-[#2e77df]"><option value="">Chọn tuần</option>{weeks.map((week) => <option key={week.id} value={week.id}>Tuần {week.week_number} ({formatDate(week.start_date)} - {formatDate(week.end_date)})</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Phiếu trực<select required value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={!weekId} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-[#2e77df] disabled:bg-slate-50"><option value="">Chọn phiếu trực</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatDate(session.date)} - Cờ đỏ {session.red_class}, trực {session.duty_class}</option>)}</select></label>
          </div>}
          <label className="text-sm font-semibold text-slate-700">Nội dung<textarea required maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} rows={6} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal leading-6 outline-none focus:border-[#2e77df] focus:ring-4 focus:ring-blue-100" /></label>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-[#2e77df]/45 bg-blue-50/50 px-4 text-sm font-semibold text-[#2e77df] hover:bg-blue-50">Đính kèm tệp<input className="sr-only" type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(event) => void handleFiles(event)} /></label>
          <p className="-mt-2 text-xs text-slate-500">JPG, JPEG, PNG hoặc PDF. Tối đa 5 tệp, 8 MB mỗi tệp.</p>
          <FileChips files={files} onRemove={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">Hủy</button><button type="submit" disabled={submitting || isOffline} className="min-h-11 rounded-xl bg-[#2e77df] px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{submitting ? "Đang gửi..." : "Gửi yêu cầu"}</button></div>
      </form>
    </ModalShell>
  )
}

function TicketModal({ ticket, loading, currentRole, currentClassId, isOffline, onClose, onTicketUpdated, onPreview }: {
  ticket: Ticket | null
  loading: boolean
  currentRole: SupportRole
  currentClassId?: number
  isOffline: boolean
  onClose: () => void
  onTicketUpdated: (ticket: Ticket) => void
  onPreview: (files: Attachment[], index: number) => void
}) {
  const [reply, setReply] = useState("")
  const [files, setFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (ticket) {
      setReply("")
      setFiles([])
    }
  }, [ticket])

  if (loading && !ticket) return <ModalShell className="max-w-xl rounded-[30px]"><div className="p-8 text-sm text-slate-500">Đang tải hội thoại...</div></ModalShell>
  if (!ticket) return null
  const ticketId = ticket.id

  async function addFiles(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const next = await readFiles(event.target.files)
      setFiles((current) => {
        if (current.length + next.length > 5) {
          toast.error("Chỉ được đính kèm tối đa 5 tệp cho mỗi tin nhắn.")
          return current
        }
        return [...current, ...next]
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đọc tệp.")
    } finally {
      event.target.value = ""
    }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault()
    if (isOffline) return toast.error("Chức năng này cần kết nối mạng.")
    try {
      setSending(true)
      const response = await api.post<{ ticket: Ticket }>(`/support/${ticketId}/messages`, { body: reply, files })
      onTicketUpdated(response.data.ticket)
      setReply("")
      setFiles([])
      toast.success("Đã gửi phản hồi.")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể gửi phản hồi."))
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell className="max-w-5xl overflow-hidden rounded-[30px]" onClose={onClose}>
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="border-b border-slate-100 px-5 py-5 pr-16 sm:pl-7 sm:pr-20">
          <div className="min-w-0"><h2 className="text-xl font-semibold text-slate-900">{ticket.title}</h2><p className="mt-1 text-sm text-slate-500">{requestTypeLabels[ticket.request_type]} - tạo {formatDateTime(ticket.created_at)}</p></div>
          <div className="mt-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(ticket.status)}`}>{statusLabels[ticket.status]}</span></div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600"><span>Người gửi: {roleLabel(ticket.creator_role)} - lớp {ticket.creator_class_name}</span>{ticket.linked_duty_session_id && <span>Phiếu trực: Tuần {ticket.linked_week_number}, {ticket.linked_duty_date ? formatDate(ticket.linked_duty_date) : ""} - Cờ đỏ {ticket.linked_red_class}, trực {ticket.linked_duty_class}</span>}</div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5 sm:px-7">
          <div className="space-y-4">
            {(ticket.messages || []).map((message) => {
              const isOwnMessage = message.sender_role === currentRole && (currentRole === "admin" || message.sender_class_id === currentClassId)
              return <article key={message.id} className={`max-w-3xl rounded-2xl border p-4 ${isOwnMessage ? "ml-auto border-blue-100 bg-blue-50/70" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="font-semibold text-slate-700">{message.sender_label}</span><span className="text-slate-400">{formatDateTime(message.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p><FileChips files={message.attachments} onPreview={(index) => onPreview(message.attachments, index)} /></article>
            })}
          </div>
        </div>
        <form onSubmit={(event) => void sendReply(event)} className="border-t border-slate-100 bg-white p-4 sm:p-5"><textarea required value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} placeholder="Nhập phản hồi..." className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 outline-none focus:border-[#2e77df] focus:ring-4 focus:ring-blue-100" /><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center"><label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-dashed border-[#2e77df]/45 px-4 text-sm font-semibold text-[#2e77df] hover:bg-blue-50">Đính kèm<input className="sr-only" type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(event) => void addFiles(event)} /></label><div className="min-w-0 flex-1"><FileChips files={files} onRemove={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} /></div><button type="submit" disabled={sending || isOffline} className="min-h-11 rounded-xl bg-[#2e77df] px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{sending ? "Đang gửi..." : "Gửi phản hồi"}</button></div></form>
      </div>
    </ModalShell>
  )
}
