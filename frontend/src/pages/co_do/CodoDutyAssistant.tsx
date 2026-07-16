import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"
import useKeyboardInsets from "../../utils/useKeyboardInsets"

type TextMessage = {
  id: string
  role: "system" | "assistant" | "user"
  timestamp: string
  content: string
}

type ResultMessage = {
  id: string
  role: "assistant"
  timestamp: string
  kind: "result"
  parsed: {
    className: string
    violation: string
    quantity: number
    score: string
  }
}

type ChatMessage = TextMessage | ResultMessage

const HEADER_DATE = "16/07/2026"

const MOCK_PROFILE = {
  redClass: "10A3",
  dutyClass: "10A8",
  weekNumber: 37,
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "system-intro",
    role: "system",
    timestamp: "07:10",
    content:
      "Xin chào Cờ đỏ lớp 10A3.\n\nHôm nay là 16/07/2026.\n\nBạn đang thực hiện ca trực của lớp 10A8.\n\nTôi sẽ hỗ trợ bạn ghi nhận vi phạm bằng ngôn ngữ tự nhiên.\n\nVí dụ:\n• 10A4 đi trễ 2 bạn\n• 11A2 không bảng tên 1 bạn\n• 12A1 tóc nhuộm 3\n\nKhi bạn gửi tin nhắn, tôi sẽ phân tích và hiển thị kết quả để bạn xác nhận trước khi lưu.",
  },
]

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

function ResultSheet({ message }: { message: ResultMessage }) {
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

          <p className="mt-3 text-sm font-medium text-slate-700">
            Đã hiểu nội dung.
          </p>

          <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="space-y-3 rounded-[24px] border border-slate-200/70 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Lớp</div>
              <div className="text-lg font-semibold text-slate-900">{message.parsed.className}</div>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Vi phạm</div>
              <div className="text-lg font-semibold text-slate-900">{message.parsed.violation}</div>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Số lượng</div>
              <div className="text-lg font-semibold text-slate-900">{message.parsed.quantity}</div>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Điểm</div>
              <div className="text-lg font-semibold text-red-600">{message.parsed.score}</div>
            </div>
          </div>

          <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="min-h-11 rounded-[20px] bg-[#2e77df] px-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              Xác nhận
            </button>
            <button
              type="button"
              className="min-h-11 rounded-[20px] border border-slate-200/80 bg-white/82 px-3 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
            >
              Chỉnh sửa
            </button>
            <button
              type="button"
              className="min-h-11 rounded-[20px] border border-red-100 bg-white/82 px-3 text-sm font-semibold text-red-600 transition duration-200 active:scale-[0.98]"
            >
              Hủy
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CodoDutyAssistant() {
  usePageTitle("EDP | AI Duty Assistant")
  useKeyboardInsets()

  const navigate = useNavigate()
  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [mockSent, setMockSent] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [messages, isSending])

  function handleSend() {
    const content = draft.trim()
    if (!content) return

    const timestamp = "07:12"
    setDraft("")

    if (mockSent) {
      setMessages((current) => [
        ...current,
        {
          id: `user-repeat-${Date.now()}`,
          role: "user",
          timestamp,
          content,
        },
      ])
      return
    }

    setMockSent(true)
    setIsSending(true)
    setMessages((current) => [
      ...current,
      {
        id: "user-sample",
        role: "user",
        timestamp,
        content,
      },
    ])

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: "assistant-result",
          role: "assistant",
          timestamp: "07:13",
          kind: "result",
          parsed: {
            className: "10A8",
            violation: "Đi trễ",
            quantity: 2,
            score: "-4",
          },
        },
      ])
      setIsSending(false)
    }, 320)
  }

  return (
    <div className="edp-mobile-shell flex flex-col bg-[radial-gradient(circle_at_top,#eef5ff_0%,#f8fbff_36%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <header className="sticky top-0 z-30 px-4 pb-3 pt-3 md:top-16">
          <div className="edp-glass-panel edp-spring-in flex min-h-[76px] items-center gap-3 rounded-[28px] px-3 py-3">
            <button
              type="button"
              onClick={() => navigate("/co_do/duty")}
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
                  {MOCK_PROFILE.dutyClass}
                </span>
                <span>•</span>
                <span>Tuần {MOCK_PROFILE.weekNumber}</span>
                <span>•</span>
                <span>{HEADER_DATE}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pb-32 pt-1">
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isUser = message.role === "user"

              if ("kind" in message) {
                return <ResultSheet key={message.id} message={message} />
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
            })}

            {isSending && (
              <div className="edp-fade-up flex justify-start">
                <div className="flex items-center gap-3 rounded-[26px] bg-white/72 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2e77df]">
                    <SparkleIcon />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" />
                    <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse [animation-delay:120ms]" />
                    <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse [animation-delay:240ms]" />
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
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={1}
                  placeholder="Ví dụ: 10A4 đi trễ 2 bạn"
                  className="edp-input w-full resize-none border-0 bg-transparent px-2 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400"
                />
              </label>

              <button
                type="button"
                onClick={handleSend}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[#2e77df] text-white shadow-[0_12px_24px_rgba(46,119,223,0.26)] transition duration-200 active:scale-[0.94]"
                aria-label="Gửi tin nhắn"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
