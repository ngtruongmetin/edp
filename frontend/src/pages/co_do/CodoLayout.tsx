import { useEffect, useRef, useState } from "react"
import { Outlet } from "react-router-dom"
import RequireRole from "../../components/RequireRole"
import { api } from "../../api/api"
import ChangePasswordModal from "../../components/ChangePasswordModal"
import toast from "react-hot-toast"

export default function AdminLayout(){

  const [user, setUser] = useState<any>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const toastShownRef = useRef(false)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    try {
      const me = await api.get("/auth/me")
      const profile = await api.get("/account/profile")

      setUser({
        ...me.data,
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
