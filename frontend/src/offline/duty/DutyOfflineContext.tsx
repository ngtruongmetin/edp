import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAuth } from "../../auth/AuthContext"
import { getDutyRepository, type OfflineDutyRepository } from "./repository"
import { api } from "../../api/api"
import { DutySyncEngine } from "./syncEngine"
import type { DutyOfflineReadiness, DutySyncStatus } from "./types"

type DutyOfflineContextValue = {
  repository: OfflineDutyRepository
  status: DutySyncStatus
  readiness: DutyOfflineReadiness
  offlineEnabled: boolean
  syncNow: () => Promise<void>
}

const DutyOfflineContext = createContext<DutyOfflineContextValue | null>(null)

const initialStatus: DutySyncStatus = {
  isOnline: navigator.onLine,
  phase: navigator.onLine ? "idle" : "offline",
  pending: 0,
  pendingOperations: 0,
  completed: 0,
  total: 0,
}

const OFFLINE_DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000

export function DutyOfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const ownerClass = user?.role === "co_do" ? user.class_name || "" : ""
  const repository = useMemo(() => getDutyRepository(ownerClass), [ownerClass])
  const [engine, setEngine] = useState<DutySyncEngine | null>(null)
  const [status, setStatus] = useState(initialStatus)
  const [readiness, setReadiness] = useState<DutyOfflineReadiness>({ ready: false, syncing: false })
  const [offlineEnabled, setOfflineEnabled] = useState(false)

  useEffect(() => {
    if (!ownerClass) return
    const nextEngine = new DutySyncEngine(ownerClass, offlineEnabled)
    const unsubscribe = nextEngine.subscribe(setStatus)
    setEngine(nextEngine)
    return () => {
      unsubscribe()
      nextEngine.destroy()
    }
  }, [offlineEnabled, ownerClass])

  useEffect(() => {
    if (!ownerClass) return
    let active = true
    const refreshSetting = async () => {
      try {
        const { data } = await api.get<{ enabled: boolean }>("/system-settings/offline-duty")
        if (!active) return
        const nextEnabled = data.enabled !== false
        setOfflineEnabled(nextEnabled)
        await repository.setOfflineEnabled(nextEnabled)
        if (!nextEnabled) await repository.clearOfflinePreload()
      } catch {
        const cached = await repository.isOfflineEnabled()
        if (active) setOfflineEnabled(cached)
      }
    }
    const intervalId = window.setInterval(() => void refreshSetting(), 60_000)
    const handleOnline = () => void refreshSetting()
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshSetting()
    }
    void refreshSetting()
    window.addEventListener("online", handleOnline)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener("online", handleOnline)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [ownerClass, repository])

  useEffect(() => {
    if (!ownerClass || !offlineEnabled) {
      setReadiness({ ready: false, syncing: false })
      return
    }

    let active = true
    let refreshPromise: Promise<void> | null = null
    const refresh = () => {
      if (refreshPromise) return refreshPromise
      refreshPromise = (async () => {
        const cached = await repository.getOfflineReadiness()
        if (!active) return
        setReadiness({ ...cached, syncing: navigator.onLine && !cached.ready })
        if (!navigator.onLine) return

        try {
          const snapshot = await repository.syncOfflineData()
          if (active) setReadiness({ ready: true, syncing: false, syncedAt: snapshot.generated_at })
        } catch (error) {
          console.error("Không thể đồng bộ dữ liệu ngoại tuyến", error)
          if (active) {
            const fallback = await repository.getOfflineReadiness()
            setReadiness({ ...fallback, syncing: false, error: "Không thể đồng bộ dữ liệu ngoại tuyến." })
          }
        }
      })().finally(() => {
        refreshPromise = null
      })
      return refreshPromise
    }

    const handleOnline = () => void refresh()
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const intervalId = window.setInterval(() => void refresh(), OFFLINE_DATA_REFRESH_INTERVAL_MS)

    void refresh()
    window.addEventListener("online", handleOnline)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener("online", handleOnline)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [offlineEnabled, ownerClass, repository])

  return (
    <DutyOfflineContext.Provider value={{ repository, status, readiness: offlineEnabled ? readiness : { ready: false, syncing: false }, offlineEnabled, syncNow: () => offlineEnabled ? engine?.sync() ?? Promise.resolve() : Promise.resolve() }}>
      {children}
    </DutyOfflineContext.Provider>
  )
}

export function useDutyOffline() {
  const value = useContext(DutyOfflineContext)
  if (!value) throw new Error("useDutyOffline must be used inside DutyOfflineProvider")
  return value
}

export function useOptionalDutyOffline() {
  return useContext(DutyOfflineContext)
}
