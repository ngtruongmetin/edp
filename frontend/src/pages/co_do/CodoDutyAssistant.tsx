import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import ClassSelector from "../../components/ClassSelector"
import CodoDutySignSheet from "../../components/CodoDutySignSheet"
import Navbar from "../../components/Navbar"
import RuleSelector, { type RuleType } from "../../components/RuleSelector"
import toast from "react-hot-toast"
import {
  type DutyAssistantChatMessage as ChatMessage,
  type DutyAssistantParsedViolationDraft as ParsedViolationDraft,
  type DutyAssistantResultMessage as ResultMessage,
  type DutyAssistantTextMessage as TextMessage,
} from "../../utils/chatHistoryService"
import { useDutyChat } from "../../utils/useDutyChat"
import { usePageTitle } from "../../utils/usePageTitle"
import useKeyboardInsets from "../../utils/useKeyboardInsets"

type DutySession = {
  id: number
  date: string
  status: string
  duty_class: string
}

type DutyViolation = {
  id: number
  rule_id: number
  quantity: number
  note: string
  name: string
  category?: string
  score_delta: number
}

type ConfirmCardMessage = {
  id: string
  role: "assistant"
  timestamp: string
  kind: "confirm"
  dutyClass: string
  violations: DutyViolation[]
}

type AssistantMessage = ChatMessage | ConfirmCardMessage

type ClassOption = {
  id: number
  name: string
}

type AssistantMeta = {
  redClass: string
  dutyClass: string
  weekNumber: number | null
  dateDisplay: string
}

type AiViolation = {
  ruleId: number
  quantity: number
  confidence?: number
  matchedText?: string
}

type ConfidenceMeta = {
  label: string
  badgeClass: string
  warning: boolean
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createTimestamp(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

function formatDateDisplay(value?: string | Date | null) {
  if (!value) {
    return formatDateDisplay(new Date())
  }

  if (typeof value === "string") {
    const [year, month, day] = value.split("-")
    if (year && month && day) {
      return `${day}/${month}/${year}`
    }
  }

  const date = value instanceof Date ? value : new Date(value)
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

function getConfidenceMeta(confidence?: number): ConfidenceMeta | null {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null
  }

  const normalized = confidence > 1 ? confidence / 100 : confidence
  const pct = Math.max(0, Math.min(100, Math.round(normalized * 100)))

  if (pct >= 90) {
    return {
      label: `${pct}%`,
      badgeClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
      warning: false,
    }
  }

  if (pct >= 60) {
    return {
      label: `${pct}%`,
      badgeClass: "border-amber-100 bg-amber-50 text-amber-800",
      warning: true,
    }
  }

  return {
    label: `${pct}%`,
    badgeClass: "border-red-100 bg-red-50 text-red-600",
    warning: true,
  }
}
function getWeekdayDisplay(value?: string | Date | null) {
  if (!value) return ""

  const date = value instanceof Date ? value : new Date(value)

  const weekdays = [
    "Chủ Nhật",
    "Thứ Hai",
    "Thứ Ba",
    "Thứ Tư",
    "Thứ Năm",
    "Thứ Sáu",
    "Thứ Bảy",
  ]

  return weekdays[date.getDay()]
}
function buildSystemMessageV2(meta: AssistantMeta): TextMessage {
  const weekday = getWeekdayDisplay(
    meta.dateDisplay.split("/").reverse().join("-")
  )

  return {
    id: "system-intro",
    role: "system",
    timestamp: createTimestamp(),
    content: `Xin chào.
Bạn đang chỉnh sửa phiếu trực ${weekday}, ngày ${meta.dateDisplay}, tuần số ${meta.weekNumber ?? "--"} của lớp ${meta.dutyClass || "--"}.
Tôi sẽ hỗ trợ bạn ghi nhận vi phạm bằng ngôn ngữ tự nhiên. Ví dụ:
• Đi trễ 2 bạn
• Không bảng tên
• Không đồng phục 3 
Lưu ý:
• Nếu không nhập số lượng, tôi sẽ mặc định là 1.
• Bạn luôn có thể chỉnh sửa kết quả trước khi lưu.
• Nếu bạn muốn ký xác nhận phiếu trực, hãy nhập lệnh /ky hoặc /ki hoặc /sign.`,
  }
}
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" />
      <path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3 10 14" />
      <path d="m21 3-7 18-4-7-7-4 18-7Z" />
    </svg>
  )
}

function getRuleMeta(ruleId: number | null, rules: RuleType[]) {
  if (ruleId == null) return null
  return rules.find((rule) => rule.id === ruleId) ?? null
}

function getViolationScore(ruleId: number | null, quantity: number, rules: RuleType[]) {
  const rule = getRuleMeta(ruleId, rules)
  if (!rule) return "--"
  return String(rule.score_delta * quantity)
}

function isResultMessage(message: AssistantMessage): message is ResultMessage {
  return "kind" in message && message.kind === "result"
}

function isConfirmCardMessage(message: AssistantMessage): message is ConfirmCardMessage {
  return "kind" in message && message.kind === "confirm"
}

function ConfirmCardMessageView({
  message,
  onConfirm,
}: {
  message: ConfirmCardMessage
  onConfirm: () => void
}) {
  return (
    <div className="edp-spring-in rounded-[30px] border border-white/65 bg-white/80 p-4 shadow-[0_18px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2e77df] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <SparkleIcon />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">AI Assistant</div>
            <div className="text-[11px] text-slate-400">{message.timestamp}</div>
          </div>

          <div className="mt-3 text-sm font-medium text-slate-700">
            Xác nhận phiếu trực
          </div>

          <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="space-y-3 rounded-[24px] border border-slate-200/70 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Lớp</div>
              <div className="text-lg font-semibold text-slate-900">{message.dutyClass || "--"}</div>
            </div>

            <div className="my-2 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Danh sách lỗi</div>

            <div className="space-y-3">
              {message.violations.length === 0 ? (
                <div className="rounded-[18px] bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Phiếu trực hiện tại chưa có lỗi.
                </div>
              ) : (
                message.violations.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[20px] border border-slate-200/70 bg-white px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  >
                    <div className="text-[15px] font-semibold text-slate-900">• {item.name}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
                      <div>Số lượng: {item.quantity}</div>
                      <div>Điểm trừ: {item.score_delta * item.quantity}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="my-2 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[20px] border border-slate-200/70 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Tổng lỗi</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {message.violations.length}
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200/70 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Tổng điểm</div>
                <div className="mt-1 text-lg font-semibold text-red-600">
                  {message.violations.reduce(
                    (sum, item) => sum + Number(item.score_delta || 0) * Number(item.quantity || 0),
                    0,
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onConfirm}
            className="mt-4 min-h-11 rounded-[20px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
          >
            Ký xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}

type ResultSheetProps = {
  message: ResultMessage
  rules: RuleType[]
  classes: ClassOption[]
  isSaving: boolean
  onStartEdit: () => void
  onRuleChange: (itemId: string, ruleId: number | null) => void
  onClassChange: (itemId: string, className: string) => void
  onQuantityChange: (itemId: string, nextQuantity: number) => void
  onOpenAddViolation: () => void
  onConfirm: () => void
  onCancel: () => void
}

function ResultSheet({
  message,
  rules,
  classes,
  isSaving,
  onStartEdit,
  onRuleChange,
  onClassChange,
  onQuantityChange,
  onOpenAddViolation,
  onConfirm,
  onCancel,
}: ResultSheetProps) {
  const isSaved = message.status === "saved"

  return (
    <div className="edp-spring-in rounded-[30px] border border-white/65 bg-white/80 p-4 shadow-[0_18px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2e77df] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <SparkleIcon />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">AI Assistant</div>
            <div className="text-[11px] text-slate-400">{message.timestamp}</div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">Đã hiểu nội dung.</p>
            {isSaved ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Đã lưu
              </span>
            ) : null}
          </div>

          <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          {message.isEditing ? (
            <div className="space-y-3">
              {message.parsed.map((item) => {
                const rule = getRuleMeta(item.ruleId, rules)

                return (
                  <div
                    key={item.id}
                    className="space-y-3 rounded-[24px] border border-slate-200/70 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  >
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                        Lớp
                      </div>
                      <ClassSelector
                        classes={classes}
                        value={item.className}
                        onChange={(value) => onClassChange(item.id, value)}
                      />
                    </div>

                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                        Vi phạm
                      </div>
                      <RuleSelector
                        rules={rules}
                        value={item.ruleId}
                        onChange={(value) => onRuleChange(item.id, value)}
                      />
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                          Số lượng
                        </div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {item.quantity}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onQuantityChange(item.id, item.quantity - 1)}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-lg font-semibold text-slate-700 transition duration-200 active:scale-[0.96]"
                          disabled={isSaving || isSaved}
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={() => onQuantityChange(item.id, item.quantity + 1)}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-lg font-semibold text-slate-700 transition duration-200 active:scale-[0.96]"
                          disabled={isSaving || isSaved}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-end gap-3 rounded-[22px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Điểm</div>
                      <div className="text-lg font-semibold text-red-600">
                        {rule ? rule.score_delta * item.quantity : "--"}
                      </div>
                    </div>

                    {getConfidenceMeta(item.confidence) ? (
                      (() => {
                        const confidence = getConfidenceMeta(item.confidence)

                        return confidence ? (
                          <div className="rounded-[22px] border border-slate-200/80 bg-white/90 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                                Độ tin cậy
                              </div>
                              <span
                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidence.badgeClass}`}
                              >
                                {confidence.label}
                              </span>
                            </div>
                            {confidence.warning ? (
                              <div className="mt-2 text-xs text-amber-700">
                                AI chưa chắc chắn về kết quả này. Vui lòng kiểm tra kỹ trước khi xác nhận.
                              </div>
                            ) : null}
                          </div>
                        ) : null
                      })()
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3 rounded-[24px] border border-slate-200/70 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              {message.parsed.length === 0 ? (
                <div className="text-sm text-slate-500">
                  Chưa xác định được lỗi phù hợp. Bạn có thể chỉnh sửa hoặc thử lại.
                </div>
              ) : (
                message.parsed.map((item) => {
                  const rule = getRuleMeta(item.ruleId, rules)

                  return (
                    <>
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[20px] bg-white/85 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-slate-900">
                            ✓ {rule?.name || "Chưa chọn lỗi"} ×{item.quantity}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.className || "--"} • Điểm {getViolationScore(item.ruleId, item.quantity, rules)}
                          </div>
                        </div>
                        <div className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
                          {getViolationScore(item.ruleId, item.quantity, rules)}
                        </div>
                      </div>

                      {getConfidenceMeta(item.confidence) ? (
                        (() => {
                          const confidence = getConfidenceMeta(item.confidence)

                          return confidence ? (
                            <div className="mt-3 rounded-[20px] border border-slate-200/80 bg-white/85 px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                                  Độ tin cậy
                                </div>
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidence.badgeClass}`}
                                >
                                  {confidence.label}
                                </span>
                              </div>
                              {confidence.warning ? (
                                <div className="mt-2 text-xs text-amber-700">
                                  AI chưa chắc chắn về kết quả này. Vui lòng kiểm tra kỹ trước khi xác nhận.
                                </div>
                              ) : null}
                            </div>
                          ) : null
                        })()
                      ) : null}
                    </>
                  )
                })
              )}
            </div>
          )}

          <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSaving || isSaved || message.parsed.length === 0}
              className="min-h-11 rounded-[20px] bg-[#2e77df] px-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Đang lưu" : "Xác nhận"}
            </button>
            <button
              type="button"
              onClick={onStartEdit}
              disabled={isSaving || isSaved}
              className="min-h-11 rounded-[20px] border border-slate-200/80 bg-white/82 px-3 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              {message.isEditing ? "Đang sửa" : "Chỉnh sửa"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving || isSaved}
              className="min-h-11 rounded-[20px] border border-red-100 bg-white/82 px-3 text-sm font-semibold text-red-600 transition duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              Hủy
            </button>
          </div>

          {message.isEditing && !isSaved ? (
            <button
              type="button"
              onClick={onOpenAddViolation}
              disabled={isSaving}
              className="mt-2 min-h-11 w-full rounded-[20px] border border-slate-200/80 bg-white/82 px-3 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              Thêm lỗi
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function CodoDutyAssistant() {
  usePageTitle("EDP | AI Duty Assistant")
  useKeyboardInsets()

  const navigate = useNavigate()
  const params = useParams()
  const { user } = useAuth()

  const dutyId = params.id ?? null
  const numericDutyId = dutyId ? Number(dutyId) : null

  const { history, setHistory, ready: historyReady } = useDutyChat(dutyId)

  const [isSending, setIsSending] = useState(false)
  const [isBooting, setIsBooting] = useState(true)
  const [invalidDuty, setInvalidDuty] = useState(false)
  const [showSignSheet, setShowSignSheet] = useState(false)
  const [session, setSession] = useState<DutySession | null>(null)
  const [rules, setRules] = useState<RuleType[]>([])
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [meta, setMeta] = useState<AssistantMeta>({
    redClass: "",
    dutyClass: "",
    weekNumber: null,
    dateDisplay: formatDateDisplay(new Date()),
  })
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)

  const messages = history.messages as AssistantMessage[]
  const draft = history.draft
  const activeSheetMessageId = history.activeSheetMessageId

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [messages, isSending, activeSheetMessageId, isBooting])

  useEffect(() => {
    if (!dutyId || !numericDutyId || !Number.isInteger(numericDutyId) || numericDutyId <= 0) {
      setInvalidDuty(true)
      navigate("/co_do/dashboard", { replace: true })
      return
    }

    let alive = true

    setIsBooting(true)
    setInvalidDuty(false)
    setSession(null)
    setRules([])
    setClasses([])
    setMeta({
      redClass: "",
      dutyClass: "",
      weekNumber: null,
      dateDisplay: formatDateDisplay(new Date()),
    })

      ; (async () => {
        try {
          const fallbackRedClass = String(user?.class_name || "")
          const mePromise = fallbackRedClass
            ? Promise.resolve({ data: { class_name: fallbackRedClass } })
            : api.get("/auth/me")

          const [meRes, rulesRes, classesRes, dutyRes] = await Promise.all([
            mePromise,
            api.get("/rules"),
            api.get("/classes"),
            api.get(`/duty/my/session/${numericDutyId}`),
          ])

          if (!alive) return

          const dutySession = dutyRes.data?.session as DutySession | null

          if (!dutySession?.id) {
            setInvalidDuty(true)
            toast.error("Không tìm thấy phiếu trực")
            navigate("/co_do/dashboard", { replace: true })
            return
          }

          setSession(dutySession)
          setRules(Array.isArray(rulesRes.data) ? rulesRes.data : [])
          setClasses(Array.isArray(classesRes.data) ? classesRes.data : [])
          setMeta({
            redClass: String(meRes.data?.class_name || fallbackRedClass || ""),
            dutyClass: String(dutySession.duty_class || ""),
            weekNumber: Number.isInteger(dutyRes.data?.week?.week_number)
              ? Number(dutyRes.data.week.week_number)
              : null,
            dateDisplay: formatDateDisplay(dutySession.date || new Date()),
          })
        } catch (err: any) {
          console.error(err)
          if (!alive) return

          setInvalidDuty(true)
          toast.error(
            err?.response?.status === 404
              ? "Không tìm thấy phiếu trực"
              : "Không thể tải dữ liệu AI Assistant",
          )
          navigate("/co_do/dashboard", { replace: true })
        } finally {
          if (alive) {
            setIsBooting(false)
          }
        }
      })()

    return () => {
      alive = false
    }
  }, [dutyId, navigate, numericDutyId, user?.class_name])

  useEffect(() => {
    if (!historyReady || isBooting || invalidDuty) return

    setHistory((current) => {
      if (current.messages.length > 0) {
        return current
      }

      return {
        ...current,
        messages: [buildSystemMessageV2(meta)],
      }
    })
  }, [historyReady, invalidDuty, isBooting, meta, setHistory])

  function updateHistory(updater: (current: typeof history) => typeof history) {
    setHistory((current) => updater(current))
  }

  function setDraftValue(value: string) {
    updateHistory((current) => ({
      ...current,
      draft: value,
    }))
  }

  function focusDraftInput() {
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }

  function appendAssistantText(content: string) {
    updateHistory((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: createId("assistant"),
          role: "assistant",
          timestamp: createTimestamp(),
          content,
        },
      ],
    }))
  }

  async function loadCurrentDutySnapshot() {
    if (!numericDutyId) return null

    const res = await api.get(`/duty/my/session/${numericDutyId}`)
    const dutySession = res.data?.session as DutySession | null

    if (!dutySession?.id) {
      return null
    }

    const freshViolations = Array.isArray(res.data?.violations) ? (res.data.violations as DutyViolation[]) : []

    setSession(dutySession)
    setMeta((current) => ({
      ...current,
      dutyClass: String(dutySession.duty_class || current.dutyClass || ""),
      dateDisplay: formatDateDisplay(dutySession.date || new Date()),
    }))

    return {
      session: dutySession,
      violations: freshViolations,
      week: res.data?.week || null,
    }
  }

  function mapApiViolationsToDrafts(violations: AiViolation[]): ParsedViolationDraft[] {
    return violations.map((item) => ({
      id: createId("violation"),
      className: meta.dutyClass || session?.duty_class || "",
      ruleId: Number.isInteger(item.ruleId) ? item.ruleId : null,
      quantity: Math.max(1, Number(item.quantity || 1)),
      confidence: item.confidence,
      matchedText: item.matchedText,
    }))
  }

  function updateResultMessage(messageId: string, updater: (message: ResultMessage) => ResultMessage) {
    updateHistory((current) => ({
      ...current,
      messages: current.messages.map((message) => {
        if (!isResultMessage(message) || message.id !== messageId) {
          return message
        }

        return updater(message)
      }),
    }))
  }

  function handleSlashCommand(input: string): boolean {
    const normalized = input.trim().toLowerCase()
    const signCommands = new Set(["/ky", "/ki", "/sign"])

    if (!signCommands.has(normalized)) {
      return false
    }

    if (!session?.id) {
      toast.error("Chưa có phiếu trực hợp lệ để ký xác nhận.")
      return true
    }

    return true
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content || isSending || isBooting || !historyReady || !numericDutyId) return

    if (handleSlashCommand(content)) {
      try {
        const snapshot = await loadCurrentDutySnapshot()
        if (!snapshot) {
          toast.error("Không thể tải dữ liệu phiếu trực để xác nhận.")
          return
        }

        const confirmMessage: ConfirmCardMessage = {
          id: createId("confirm"),
          role: "assistant",
          timestamp: createTimestamp(),
          kind: "confirm",
          dutyClass: String(snapshot.session.duty_class || meta.dutyClass || ""),
          violations: snapshot.violations,
        }

        updateHistory((current) => ({
          ...current,
          draft: "",
          messages: [
            ...(current.messages as AssistantMessage[]).filter((message) => !isConfirmCardMessage(message)),
            confirmMessage,
          ] as any,
        }))
        focusDraftInput()
      } catch (err) {
        console.error(err)
        toast.error("Không thể tải dữ liệu phiếu trực để xác nhận.")
      }

      return
    }

    const userMessage: TextMessage = {
      id: createId("user"),
      role: "user",
      timestamp: createTimestamp(),
      content,
    }

    updateHistory((current) => ({
      ...current,
      draft: "",
      messages: [...current.messages, userMessage],
    }))
    focusDraftInput()

    if (!session?.id) {
      appendAssistantText("Chưa có phiếu trực hợp lệ để phân tích nội dung. Vui lòng quay lại danh sách phiếu trực.")
      return
    }

    setIsSending(true)

    try {
      const res = await api.post("/ai/codo/parse", {
        dutyId: numericDutyId,
        message: content,
      })

      const violations = Array.isArray(res.data?.violations)
        ? (res.data.violations as AiViolation[])
        : []

      if (import.meta.env.DEV) {
        console.log("AI violations", violations)
        console.log("Rules", rules)
        console.log(
          violations.map((v) => ({
            aiRuleId: v.ruleId,
            matchedRule: rules.find((r) => r.id === v.ruleId) ?? null,
          })),
        )
      }

      if (violations.length === 0) {
        appendAssistantText("Tôi chưa xác định được vi phạm phù hợp. Bạn có thể nhập lại hoặc chỉnh sửa thủ công.")
        return
      }

      const resultMessage: ResultMessage = {
        id: createId("result"),
        role: "assistant",
        timestamp: createTimestamp(),
        kind: "result",
        status: "draft",
        isEditing: false,
        parsed: mapApiViolationsToDrafts(violations),
      }

      updateHistory((current) => ({
        ...current,
        messages: [...current.messages, resultMessage],
      }))
    } catch (err) {
      console.error(err)
      appendAssistantText("Không thể phân tích nội dung.\n\nVui lòng thử lại.")
    } finally {
      setIsSending(false)
    }
  }

  function handleDraftKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return
    }

    const composingEvent = event as ReactKeyboardEvent<HTMLTextAreaElement> & {
      isComposing?: boolean
    }
    const nativeEvent = event.nativeEvent as KeyboardEvent & {
      isComposing?: boolean
    }

    if (composingEvent.isComposing || nativeEvent.isComposing || isComposingRef.current) {
      return
    }

    event.preventDefault()
    void handleSend()
  }

  function handleStartEdit(messageId: string) {
    updateResultMessage(messageId, (message) => ({
      ...message,
      isEditing: true,
    }))
  }

  function handleRuleChange(messageId: string, itemId: string, ruleId: number | null) {
    updateResultMessage(messageId, (message) => ({
      ...message,
      parsed: message.parsed.map((item) =>
        item.id === itemId
          ? {
            ...item,
            ruleId,
          }
          : item,
      ),
    }))
  }

  function handleClassChange(messageId: string, itemId: string, className: string) {
    updateResultMessage(messageId, (message) => ({
      ...message,
      parsed: message.parsed.map((item) =>
        item.id === itemId
          ? {
            ...item,
            className,
          }
          : item,
      ),
    }))
  }

  function handleQuantityChange(messageId: string, itemId: string, nextQuantity: number) {
    updateResultMessage(messageId, (message) => ({
      ...message,
      parsed: message.parsed.map((item) =>
        item.id === itemId
          ? {
            ...item,
            quantity: Math.max(1, nextQuantity),
          }
          : item,
      ),
    }))
  }

  function handleOpenAddViolation(messageId: string) {
    updateHistory((current) => ({
      ...current,
      activeSheetMessageId: messageId,
    }))
  }

  function handleAddViolationToDraft(messageId: string, ruleId: number) {
    updateResultMessage(messageId, (message) => ({
      ...message,
      isEditing: true,
      parsed: [
        ...message.parsed,
        {
          id: createId("violation"),
          className: meta.dutyClass || session?.duty_class || "",
          ruleId,
          quantity: 1,
        },
      ],
    }))

    updateHistory((current) => ({
      ...current,
      activeSheetMessageId: null,
    }))
  }

  function handleCancelDraft(messageId: string) {
    updateHistory((current) => ({
      ...current,
      activeSheetMessageId:
        current.activeSheetMessageId === messageId ? null : current.activeSheetMessageId,
      messages: current.messages.filter((message) => message.id !== messageId),
    }))
  }

  async function handleConfirm(messageId: string) {
    const targetMessage = messages.find(
      (message): message is ResultMessage => isResultMessage(message) && message.id === messageId,
    )

    if (!targetMessage || !session?.id) return

    const invalidItem = targetMessage.parsed.find(
      (item) =>
        item.ruleId == null ||
        item.quantity < 1 ||
        item.className !== (meta.dutyClass || session.duty_class),
    )

    if (invalidItem) {
      toast.error("Draft hiện tại chưa hợp lệ để lưu vào phiếu trực.")
      return
    }

    setSavingMessageId(messageId)

    try {
      for (const item of targetMessage.parsed) {
        await api.post("/duty/violation", {
          session_id: session.id,
          rule_id: item.ruleId,
          quantity: item.quantity,
          note: "",
        })
      }

      updateResultMessage(messageId, (message) => ({
        ...message,
        status: "saved",
        isEditing: false,
      }))

      toast.success("Đã lưu vi phạm vào phiếu trực")
    } catch (err) {
      console.error(err)
      appendAssistantText("Không thể lưu vi phạm vào phiếu trực.\n\nVui lòng thử lại.")
    } finally {
      setSavingMessageId(null)
    }
  }

  if (!dutyId || invalidDuty) {
    return null
  }

  const assistantClasses = meta.dutyClass
    ? classes.filter((item) => item.name === meta.dutyClass)
    : classes

  return (
    <div className="edp-mobile-shell flex flex-col bg-[radial-gradient(circle_at_top,#eef5ff_0%,#f8fbff_36%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <header className="sticky top-0 z-30 px-4 pb-3 pt-3 md:top-16">
          <div className="edp-glass-panel edp-spring-in flex min-h-[76px] items-center gap-3 rounded-[28px] px-3 py-3">
            <button
              type="button"
              onClick={() => navigate(`/co_do/duty/${dutyId}`)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-white/55 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition duration-200 active:scale-[0.96]"
              aria-label="Quay lại phiếu trực"
            >
              <BackIcon />
            </button>

            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold tracking-tight text-slate-900">
                AI Assistant
              </div>
              <div className="mt-0.5 truncate text-[13px] text-slate-500">
                Ca trực hôm nay
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white/60 px-2.5 py-1 font-medium text-slate-700">
                  {meta.dutyClass || "--"}
                </span>
                <span>•</span>
                <span>Tuần {meta.weekNumber ?? "--"}</span>
                <span>•</span>
                <span>{meta.dateDisplay}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pb-32 pt-1">
          <div className="space-y-4">
            {isBooting ? (
              <div className="edp-fade-up flex justify-start">
                <div className="edp-glass-panel rounded-[28px] rounded-bl-md px-4 py-4 text-sm text-slate-500">
                  Đang tải AI Assistant...
                </div>
              </div>
            ) : (
              messages.map((message, index) => {
                const isUser = message.role === "user"

                if (isConfirmCardMessage(message)) {
                  return (
                    <ConfirmCardMessageView
                      key={message.id}
                      message={message}
                      onConfirm={() => setShowSignSheet(true)}
                    />
                  )
                }

                if (isResultMessage(message)) {
                  return (
                    <ResultSheet
                      key={message.id}
                      message={message}
                      rules={rules}
                      classes={assistantClasses}
                      isSaving={savingMessageId === message.id}
                      onStartEdit={() => handleStartEdit(message.id)}
                      onRuleChange={(itemId, ruleId) => handleRuleChange(message.id, itemId, ruleId)}
                      onClassChange={(itemId, className) => handleClassChange(message.id, itemId, className)}
                      onQuantityChange={(itemId, quantity) => handleQuantityChange(message.id, itemId, quantity)}
                      onOpenAddViolation={() => handleOpenAddViolation(message.id)}
                      onConfirm={() => void handleConfirm(message.id)}
                      onCancel={() => handleCancelDraft(message.id)}
                    />
                  )
                }

                return (
                  <div
                    key={message.id}
                    className={`edp-fade-up flex ${isUser ? "justify-end" : "justify-start"}`}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className={`flex max-w-[94%] gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                      {!isUser && (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/78 text-[#2e77df] shadow-[0_10px_24px_rgba(46,119,223,0.12)] backdrop-blur-xl">
                          <SparkleIcon />
                        </div>
                      )}

                      <div
                        className={
                          isUser
                            ? "rounded-[26px] rounded-br-md bg-[#2e77df] px-4 py-3 text-white shadow-[0_16px_28px_rgba(46,119,223,0.24)]"
                            : "edp-glass-panel rounded-[28px] rounded-bl-md px-4 py-4 text-slate-700"
                        }
                      >
                        {!isUser && (
                          <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {message.role === "system" ? "AI Assistant" : "Assistant"}
                            </span>
                            <span className="text-[11px] text-slate-400">{message.timestamp}</span>
                          </div>
                        )}

                        {isUser && (
                          <div className="mb-1 text-right text-[11px] font-medium text-white/72">
                            {message.timestamp}
                          </div>
                        )}

                        <p className="whitespace-pre-line text-[15px] leading-7">
                          {message.content}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}

            {isSending && !isBooting && (
              <div className="edp-fade-up flex justify-start">
                <div className="flex items-center gap-3 rounded-[26px] bg-white/72 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2e77df]">
                    <SparkleIcon />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 [animation-delay:240ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        <div
          className="sticky bottom-0 z-40 px-4 pb-4 pt-3"
          style={{
            paddingBottom:
              "calc(1rem + env(safe-area-inset-bottom) + var(--edp-mobile-nav-space, 0px) + var(--edp-keyboard-offset, 0px))",
          }}
        >
          <div className="edp-glass-panel edp-spring-in rounded-[30px] p-3 shadow-[0_18px_38px_rgba(15,23,42,0.10)]">
            <div className="flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Nhập nội dung vi phạm</span>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraftValue(e.target.value)
                  }}
                  onKeyDown={handleDraftKeyDown}
                  onCompositionStart={() => {
                    isComposingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false
                  }}
                  rows={1}
                  placeholder="Ví dụ: Đi trễ 2 bạn"
                  className="edp-input w-full resize-none border-0 bg-transparent px-2 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400"
                />
              </label>

              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending || isBooting || !draft.trim() || !historyReady}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[#2e77df] text-white shadow-[0_12px_24px_rgba(46,119,223,0.26)] transition duration-200 active:scale-[0.94] disabled:opacity-50"
                aria-label="Gửi tin nhắn"
              >
                <SendIcon />
              </button>
            </div>
        </div>
      </div>
    </div>

      <CodoDutySignSheet
        open={showSignSheet && !!session}
        session={session}
        onClose={() => setShowSignSheet(false)}
        onSigned={async () => {
          const res = await api.get(`/duty/my/session/${numericDutyId}`)
          const dutySession = res.data?.session as DutySession | null

          if (dutySession?.id) {
            setSession(dutySession)
            setMeta((current) => ({
              ...current,
              dutyClass: String(dutySession.duty_class || current.dutyClass || ""),
              dateDisplay: formatDateDisplay(dutySession.date || new Date()),
            }))
          }

          setDraftValue("")
          setShowSignSheet(false)
          focusDraftInput()
        }}
      />

      {activeSheetMessageId && !isBooting ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/28 backdrop-blur-[2px]"
            onClick={() =>
              updateHistory((current) => ({
                ...current,
                activeSheetMessageId: null,
              }))
            }
          />

          <div
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[32px] border border-white/55 bg-white/78 p-4 shadow-[0_-18px_42px_rgba(15,23,42,0.12)] backdrop-blur-2xl"
            style={{
              paddingBottom:
                "calc(1rem + env(safe-area-inset-bottom) + var(--edp-keyboard-offset, 0px))",
              maxHeight: "70dvh",
            }}
          >
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-slate-900">Thêm lỗi</div>
                <div className="mt-1 text-sm text-slate-500">
                  Chọn thêm một vi phạm để bổ sung vào draft hiện tại.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateHistory((current) => ({
                    ...current,
                    activeSheetMessageId: null,
                  }))
                }
                className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Đóng
              </button>
            </div>

            <div className="mt-4 space-y-2 overflow-y-auto pb-1">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => handleAddViolationToDraft(activeSheetMessageId, rule.id)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white/82 px-4 py-3 text-left transition duration-200 active:scale-[0.98]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2e77df]">
                    <SparkleIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-slate-900">
                      {rule.name}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {rule.category}
                    </div>
                  </div>
                  <div className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
                    {rule.score_delta}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
