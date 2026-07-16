import { useEffect, useRef, useState } from "react"
import { Outlet } from "react-router-dom"
import RequireRole from "../../components/RequireRole"
import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import ChangePasswordModal from "../../components/ChangePasswordModal"
import toast from "react-hot-toast"

export default function AdminLayout(){
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

      if (!profile.data.password_changed && !toastShownRef.current) {
        setShowChangePassword(true)
        toastShownRef.current = true
        toast("Bạn cần đổi mật khẩu trước khi tiếp tục", {
        })
      }
    } catch (err) {
      console.error(err)
    }
  }

  return(

    <RequireRole role="co_do">

      <Outlet context={{ user, setShowChangePassword }} />

      {showChangePassword && (
        <ChangePasswordModal
          role="co_do"
          onSuccess={() => {
            setShowChangePassword(false)
            loadProfile()
          }}
          canClose={user?.password_changed === true}
        />
      )}

    </RequireRole>

  )

}
