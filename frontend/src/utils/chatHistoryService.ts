export type DutyAssistantTextMessage = {
  id: string
  role: "system" | "assistant" | "user"
  timestamp: string
  content: string
}

export type DutyAssistantParsedViolationDraft = {
  id: string
  className: string
  ruleId: number | null
  quantity: number
  studentName: string
  confidence?: number
  matchedText?: string
}

export type DutyAssistantResultMessage = {
  id: string
  role: "assistant"
  timestamp: string
  kind: "result"
  status: "draft" | "saved" | "edited"
  isEditing: boolean
  lastSavedSignature?: string | null
  parsed: DutyAssistantParsedViolationDraft[]
}

export type DutyAssistantChatMessage =
  | DutyAssistantTextMessage
  | DutyAssistantResultMessage

export type DutyAssistantHistory = {
  messages: DutyAssistantChatMessage[]
  draft: string
  activeSheetMessageId: string | null
}

export function createEmptyDutyAssistantHistory(): DutyAssistantHistory {
  return {
    messages: [],
    draft: "",
    activeSheetMessageId: null,
  }
}

function isDutyAssistantTextMessage(value: any): value is DutyAssistantTextMessage {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    (value.role === "system" || value.role === "assistant" || value.role === "user") &&
    typeof value.timestamp === "string" &&
    typeof value.content === "string"
  )
}

function isDutyAssistantResultMessage(value: any): value is DutyAssistantResultMessage {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.role === "assistant" &&
    value.kind === "result" &&
    (value.status === "draft" || value.status === "saved" || value.status === "edited") &&
    typeof value.isEditing === "boolean" &&
    Array.isArray(value.parsed)
  )
}

export function normalizeDutyAssistantHistory(value: any): DutyAssistantHistory | null {
  if (!value || typeof value !== "object") return null

  const draft = typeof value.draft === "string" ? value.draft : ""
  const activeSheetMessageId =
    typeof value.activeSheetMessageId === "string" ? value.activeSheetMessageId : null

  const messages = Array.isArray(value.messages)
    ? value.messages.filter((message: unknown) => {
        if (isDutyAssistantTextMessage(message)) {
          return true
        }

        if (!isDutyAssistantResultMessage(message)) {
          return false
        }

        const parsed = message.parsed.filter(
          (item: any) =>
            item &&
            typeof item === "object" &&
            typeof item.id === "string" &&
            typeof item.className === "string" &&
            (item.ruleId === null || Number.isInteger(item.ruleId)) &&
            Number.isFinite(Number(item.quantity)),
        )

        if (parsed.length !== message.parsed.length) {
          return false
        }

        return (
          message.lastSavedSignature == null ||
          typeof message.lastSavedSignature === "string"
        )
      })
    : []

  return {
    messages,
    draft,
    activeSheetMessageId,
  }
}
