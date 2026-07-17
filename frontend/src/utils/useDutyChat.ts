import { useEffect, useState } from "react"
import {
  createEmptyDutyAssistantHistory,
  clearHistory,
  loadHistory,
  saveHistory,
  type DutyAssistantHistory,
} from "./chatHistoryService"

export function useDutyChat(dutyId: string | null) {
  const [history, setHistory] = useState<DutyAssistantHistory>(createEmptyDutyAssistantHistory())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!dutyId) {
      setHistory(createEmptyDutyAssistantHistory())
      setReady(true)
      return
    }

    setReady(false)
    const loaded = loadHistory(dutyId)
    setHistory(loaded ?? createEmptyDutyAssistantHistory())
    setReady(true)
  }, [dutyId])

  useEffect(() => {
    if (!dutyId || !ready) return
    saveHistory(dutyId, history)
  }, [dutyId, ready, history])

  function clearDutyChat() {
    if (!dutyId) return
    clearHistory(dutyId)
    setHistory(createEmptyDutyAssistantHistory())
  }

  return {
    history,
    setHistory,
    ready,
    clearDutyChat,
  }
}
