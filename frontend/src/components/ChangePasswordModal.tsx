import { useState } from "react"
import { api } from "../api/api"
import toast from "react-hot-toast"

type Props = {
  role: "bancansu" | "co_do" | "admin" | "gvcn"
  onSuccess: () => void
  canClose?: boolean
}

type Mode = "choose" | "password" | "pin"

export default function ChangePasswordModal({ role, onSuccess, canClose = true }: Props) {
  // First login (canClose=false): force password flow
  // Settings (canClose=true): allow to choose
  const isFirstLogin = canClose === false
  const [mode, setMode] = useState<Mode>(
    role === "bancansu" && canClose ? "choose" : "password"
  )
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const [oldPin, setOldPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [pinSuccess, setPinSuccess] = useState(false)

  async function handleChangePassword() {
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast.error("Vui lòng điền đầy đủ thông tin")
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu mới không khớp")
      return
    }

    if (newPassword.length < 6) {
      toast.error("Mật khẩu phải dài ít nhất 6 ký tự")
      return
    }

    setLoading(true)
    try {
      await api.post("/account/change-password", {
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })

      toast.success("Đã cập nhật mật khẩu")
      setPasswordSuccess(true)
      
      if (role === "bancansu") {
        // Auto-move to PIN: first login → force, settings → can see success + option
        if (isFirstLogin) {
          // First login: auto-move to PIN after success
          setTimeout(() => {
            setMode("pin")
            setOldPassword("")
            setNewPassword("")
            setConfirmPassword("")
          }, 500)
        } else {
          // Settings: show success, allow to proceed
          setOldPassword("")
          setNewPassword("")
          setConfirmPassword("")
        }
      } else {
        // Admin/Co_do: done after password
        setTimeout(onSuccess, 500)
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Lỗi khi cập nhật mật khẩu"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleChangePin() {
    if (!oldPin || !newPin || !confirmPin) {
      toast.error("Vui lòng điền đầy đủ thông tin")
      return
    }

    if (newPin !== confirmPin) {
      toast.error("Mã PIN không khớp")
      return
    }

    // PIN must be exactly 6 digits
    if (String(newPin).length !== 6 || !/^\d{6}$/.test(String(newPin))) {
      toast.error("Mã PIN phải là 6 chữ số")
      return
    }

    setLoading(true)
    try {
      await api.post("/account/change-pin", {
        old_pin: oldPin,
        new_pin: newPin,
        confirm_pin: confirmPin,
      })

      toast.success("Đã cập nhật mã PIN")
      setPinSuccess(true)
      setTimeout(onSuccess, 500)
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Lỗi khi cập nhật mã PIN"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleSkip() {
    if (!canClose) {
      toast.error("Vui lòng cập nhật ít nhất một trong hai")
      return
    }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-3xl p-6 max-w-md w-full mx-4 shadow-2xl">
        {/* CHOOSE MODE - Only for settings (canClose=true) */}
        {mode === "choose" && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Cập nhật tài khoản
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Chọn cập nhật mật khẩu hoặc mã PIN
            </p>

            <div className="space-y-3">
              <button
                onClick={() => setMode("password")}
                className="w-full rounded-xl border-2 border-[#2e77df] bg-blue-50 px-4 py-4 text-left font-semibold text-[#2e77df] hover:bg-blue-100 transition"
              >
                Đổi Mật Khẩu
              </button>

              {role === "bancansu" && (
                <button
                  onClick={() => setMode("pin")}
                  className="w-full rounded-xl border-2 border-orange-400 bg-orange-50 px-4 py-4 text-left font-semibold text-orange-600 hover:bg-orange-100 transition"
                >
                  Đổi Mã PIN (6 chữ số)
                </button>
              )}
            </div>

            <div className="mt-6">
              <button
                onClick={handleSkip}
                className="w-full rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
              >
                Bỏ qua
              </button>
            </div>
          </>
        )}

        {/* PASSWORD MODE */}
        {mode === "password" && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Đổi Mật Khẩu</h2>
            <p className="text-sm text-gray-600 mb-6">
              {role === "gvcn" ? "Cập nhật mật khẩu đăng nhập của thầy/cô" : "Cập nhật mật khẩu đăng nhập của bạn"}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mật khẩu cũ
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e77df]"
                  placeholder="Nhập mật khẩu cũ"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e77df]"
                  placeholder="Ít nhất 6 ký tự"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e77df]"
                  placeholder="Nhập lại mật khẩu mới"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              {/* Back/Skip button */}
              {role === "bancansu" && canClose ? (
                <button
                  onClick={() => setMode("choose")}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                  disabled={loading}
                >
                  Quay lại
                </button>
              ) : canClose ? (
                <button
                  onClick={handleSkip}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                  disabled={loading}
                >
                  Bỏ qua
                </button>
              ) : null}
              
              <button
                onClick={handleChangePassword}
                className="flex-1 rounded-xl bg-[#2e77df] py-2.5 text-sm font-semibold text-white hover:bg-[#1f5fc0] disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Đang cập nhật..." : "Cập nhật"}
              </button>
            </div>

            {role === "bancansu" && passwordSuccess && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl text-center text-sm text-green-700 font-semibold">
                Đã cập nhật mật khẩu
              </div>
            )}
          </>
        )}

        {/* PIN MODE (BCS only) */}
        {mode === "pin" && role === "bancansu" && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">🔑 Đổi Mã PIN</h2>
            <p className="text-sm text-gray-600 mb-6">Mã PIN phải là 6 chữ số</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mã PIN cũ (6 chữ số)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-center text-2xl tracking-widest"
                  placeholder="●●●●●●"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mã PIN mới (6 chữ số)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-center text-2xl tracking-widest"
                  placeholder="●●●●●●"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Xác nhận mã PIN mới (6 chữ số)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-center text-2xl tracking-widest"
                  placeholder="●●●●●●"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              {!isFirstLogin && (
                <button
                  onClick={() => setMode("choose")}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                  disabled={loading}
                >
                  Quay lại
                </button>
              )}
              <button
                onClick={handleChangePin}
                className={`rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 ${
                  isFirstLogin ? "w-full" : "flex-1"
                }`}
                disabled={loading}
              >
                {loading ? "⏳ Đang cập nhật..." : "Cập nhật"}
              </button>
            </div>

            {pinSuccess && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl text-center text-sm text-green-700 font-semibold">
                ✅ Đã cập nhật mã PIN
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
