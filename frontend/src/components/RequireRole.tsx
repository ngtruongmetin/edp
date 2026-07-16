import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

type Props = {
  role: string
  children: ReactNode
}

export default function RequireRole({ role, children }: Props) {
  const { user, loading } = useAuth()

  console.log({
    loading,
    user,
    offline: !window.navigator.onLine,
  })

  if (loading) {
    return null
  }

  if (!user || user.role !== role) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
