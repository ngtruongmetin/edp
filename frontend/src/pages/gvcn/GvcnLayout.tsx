import { useEffect, useState, useRef } from "react"
import { Outlet } from "react-router-dom"
import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import RequireRole from "../../components/RequireRole"
import ChangePasswordModal from "../../components/ChangePasswordModal"
import toast from "react-hot-toast"

export default function GvcnLayout() {
  const { user: authUser, isOffline } = useAuth()
  const [user, setUser] = useState<any>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const toastShownRef = useRef(false)

  useEffect(() => {
    setUser((prev: any) => ({
      ...authUser,
      password_changed: prev?.password_changed,
    }))
  }, [authUser])

  useEffect(() => {
    if (!authUser || isOffline) return
    loadProfile()
  }, [authUser, isOffline])

  async function loadProfile() {
    try {
      const profile = await api.get("/account/profile")

      setUser({
        ...authUser,
        password_changed: profile.data.password_changed,
      })

      // Force password change on first login (only show toast once)
      if (!profile.data.password_changed && !toastShownRef.current) {
        setShowChangePassword(true)
        toastShownRef.current = true
        toast("Bạn cần cập nhật tài khoản trước khi tiếp tục", {
          icon: "🔒",
        })
      }
    } catch (err: any) {
      console.error(err)
    }
  }

  return (
    <RequireRole role="gvcn">
      <Outlet context={{ user, setShowChangePassword }} />

      {showChangePassword && (
        <ChangePasswordModal
          role="gvcn"
          onSuccess={() => {
            setShowChangePassword(false)
            loadProfile()
          }}
          // Avoid a brief render where user is still null -> canClose becomes undefined -> modal becomes closable.
          canClose={user?.password_changed === true}
        />
      )}
    </RequireRole>
  )
}
