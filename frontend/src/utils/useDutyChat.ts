import { useEffect, useState } from "react"
import { api } from "../api/api"
import {
  createEmptyDutyAssistantHistory,
  normalizeDutyAssistantHistory,
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

    let active = true
    setReady(false)

    void api.get(`/ai/codo/history/${dutyId}`)
      .then((response) => {
        if (!active) return
        setHistory(normalizeDutyAssistantHistory(response.data?.history) ?? createEmptyDutyAssistantHistory())
      })
      .catch((error) => {
        console.error("Không thể tải lịch sử AI Assistant", error)
        if (active) setHistory(createEmptyDutyAssistantHistory())
      })
      .finally(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
    }
  }, [dutyId])

  useEffect(() => {
    if (!dutyId || !ready) return

    const timer = window.setTimeout(() => {
      void api.put(`/ai/codo/history/${dutyId}`, { history }).catch((error) => {
        console.error("Không thể lưu lịch sử AI Assistant", error)
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [dutyId, ready, history])

  async function clearDutyChat() {
    if (!dutyId) return
    await api.delete(`/ai/codo/history/${dutyId}`)
    setHistory(createEmptyDutyAssistantHistory())
  }

  return {
    history,
    setHistory,
    ready,
    clearDutyChat,
  }
}
