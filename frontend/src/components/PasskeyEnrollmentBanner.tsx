import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"

import {
  getPasskeyErrorMessage,
  isPasskeyRegistrationInProgressError,
  registerPasskey,
  supportsPasskeys,
} from "../passkeys"

const PROMPT_KEY = "edp:prompt-passkey-enrollment"

function PasskeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="3" />
      <path d="M10.1 12.9 20 3m-3 0h3v3m-7 4 2 2m1-5 2 2" />
    </svg>
  )
}

export default function PasskeyEnrollmentBanner() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(PROMPT_KEY) !== "1" || !supportsPasskeys()) return
    setVisible(true)
  }, [])

  function dismiss() {
    sessionStorage.removeItem(PROMPT_KEY)
    setVisible(false)
  }

  async function enable() {
    try {
      setRegistering(true)
      await registerPasskey()
      toast.success("Đăng ký Passkey thành công.")
      dismiss()
    } catch (err) {
      if (isPasskeyRegistrationInProgressError(err)) return
      toast.error(getPasskeyErrorMessage(err, "Không thể đăng ký Passkey.", "Bạn đã hủy đăng ký Passkey."))
    } finally {
      setRegistering(false)
    }
  }

  if (!visible) return null

  return (
    <aside className="fixed bottom-24 right-4 z-[60] w-[calc(100%-2rem)] max-w-md edp-glass-panel rounded-[28px] p-5 shadow-[0_18px_36px_rgba(15,23,42,0.14)] sm:bottom-5 sm:right-5" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-[#eff6ff] text-[#2e77df]">
          <PasskeyIcon />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Đăng nhập nhanh và an toàn hơn bằng Passkey</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Bạn có thể sử dụng vân tay, Face ID hoặc Windows Hello để đăng nhập mà không cần nhập mật khẩu.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={() => void enable()} disabled={registering} className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
          {registering ? "Đang đăng ký..." : "Bật ngay"}
        </button>
        <button type="button" onClick={dismiss} disabled={registering} className="min-h-11 rounded-[18px] border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
          Để sau
        </button>
        <button type="button" onClick={() => navigate("/account/settings")} disabled={registering} className="min-h-11 rounded-[18px] px-3 text-sm font-semibold text-[#2e77df] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto">
          Quản lý
        </button>
      </div>
    </aside>
  )
}
