import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api } from "../api/api"
import {
  buildDashboardCacheKey,
  clearCachedDashboard,
  clearCachedUser,
  getCachedUser,
  setCachedUser,
  type CachedUser,
} from "../utils/offlineCache"
import { dutyStorage } from "../offline/duty/storage"

export type User = {
  role: string
  class_id?: number
  class_name?: string
  username?: string
}

type AuthType = {
  user: User | null
  loading: boolean
  isOffline: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthType | null>(null)

function normalizeRole(role: string) {
  const legacyClassRole = `ban${"cansu"}`
  return role === legacyClassRole ? "ban_can_su" : role
}

function toCachedUser(user: User): CachedUser {
  return {
    role: normalizeRole(user.role),
    class_id: user.class_id,
    username: user.username,
    class_name: user.class_name,
    displayName: user.class_name || user.username || user.role,
    lastVerifiedAt: new Date().toISOString(),
  }
}

function fromCachedUser(user: CachedUser): User {
  return {
    role: normalizeRole(user.role),
    class_id: user.class_id,
    username: user.username,
    class_name: user.class_name,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(!window.navigator.onLine)

  async function restoreCachedUser() {
    try {
      console.log("getCurrentUser()")
      const cachedUser = await getCachedUser()
      if (cachedUser?.role !== "co_do") {
        setUser(null)
        return null
      }
      console.log("cachedUser", cachedUser)
      const restoredUser = cachedUser ? fromCachedUser(cachedUser) : null
      console.log("setUser()", restoredUser)
      setUser(restoredUser)
      return restoredUser
    } catch (err) {
      console.error(err)
      console.log("setUser()", null)
      setUser(null)
      return null
    }
  }

  async function refresh() {
    try {
      const res = await api.get("/auth/me")
      const currentUser = { ...res.data, role: normalizeRole(res.data.role) }
      if (user?.role === "co_do" && (currentUser.role !== "co_do" || user.class_name !== currentUser.class_name)) {
        await dutyStorage.clearAll()
      }
      setUser(currentUser)
      setIsOffline(false)
      await setCachedUser(toCachedUser(currentUser))
    } catch (err: any) {
      const status = err?.response?.status
      const isAuthFailure = status === 401 || status === 403

      if (isAuthFailure) {
        if (user?.role === "co_do") await dutyStorage.clearAll()
        setUser(null)
        await clearCachedUser()
        setIsOffline(false)
      } else {
        await restoreCachedUser()
        setIsOffline(true)
      }
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    const currentUser = user

    if (window.navigator.onLine) {
      await api.post("/auth/logout")
    }

    if (currentUser) {
      await clearCachedDashboard(buildDashboardCacheKey(currentUser))
      if (currentUser.role === "co_do") await dutyStorage.clearAll()
    }

    await clearCachedUser()
    setUser(null)
  }

  useEffect(() => {
    console.log("AuthContext mounted")
    refresh()
  }, [])

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true)
      setUser((current) => current?.role === "co_do" ? current : null)
    }

    function handleOnline() {
      setIsOffline(false)
      void refresh()
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, isOffline, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)

  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider")
  }

  return ctx
}
