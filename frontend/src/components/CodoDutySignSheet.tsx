import { useEffect, useRef, useState } from "react"

import toast from "react-hot-toast"

import CameraCapture from "./CameraCapture"
import { useDutyOffline } from "../offline/duty/DutyOfflineContext"
import { offlinePinVerifier } from "../offline/duty/offlinePinVerifier"

type SignableDutySession = {
  id: number
  duty_class: string
  clientId?: string
  localId?: number
  serverId?: number
}

type Props = {
  open: boolean
  session: SignableDutySession | null
  onClose: () => void
  onSigned?: () => Promise<void> | void
}

export default function CodoDutySignSheet({
  open,
  session,
  onClose,
  onSigned,
}: Props) {
  const { repository, syncNow } = useDutyOffline()
  const [pin, setPin] = useState("")
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [signing, setSigning] = useState(false)
  const pinInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      setPin("")
      setPhotoFile(null)
      setSigning(false)
      return
    }

    window.setTimeout(() => {
      pinInputRef.current?.focus()
    }, 0)
  }, [open])

  if (!open || !session) {
    return null
  }

  const activeSession = session

  async function handleConfirm() {
    if (!pin.trim()) {
      toast.error("Nhập PIN")
      return
    }

    if (pin.trim().length !== 6) {
      toast.error("PIN gồm 6 chữ số")
      return
    }

    setSigning(true)

    try {
      let signableSession = await repository.getSessionByRouteId(activeSession.id)
      if (!signableSession && navigator.onLine) {
        signableSession = await repository.loadSessionById(activeSession.id)
      }
      if (!signableSession) throw new Error("DUTY_OFFLINE_SESSION_MISSING")
      if (navigator.onLine && !signableSession.serverId) {
        await syncNow()
        signableSession = await repository.getSessionByRouteId(signableSession.localId) || signableSession
      }
      if (navigator.onLine) {
        try {
          await repository.syncOfflineData()
        } catch (error) {
          console.warn("Khong the lam moi du lieu ngoai tuyen truoc khi ky.", error)
        }
      }
      await offlinePinVerifier.authorize(signableSession, pin)
      await repository.queueSignature(signableSession, photoFile)
      void syncNow()

      toast.success("Đã ký xác nhận")

      try {
        await Promise.resolve(onSigned?.())
      } catch (err) {
        console.error(err)
      }

      onClose()
      setPin("")
      setPhotoFile(null)
    } catch (err: any) {
      console.error(err)
      const code = err instanceof Error ? err.message : ""
      const message = code === "OFFLINE_DATA_NOT_READY"
        ? "Thiết bị chưa sẵn sàng làm việc ngoại tuyến."
        : code === "OFFLINE_PIN_LOCKED"
          ? "PIN tạm khóa 5 phút"
          : code === "INVALID_OFFLINE_PIN" || err?.response?.data?.error === "Invalid pin"
            ? "PIN không đúng"
            : "Không thể ký xác nhận"
      toast.error(message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (!signing) onClose()
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl"
        style={{
          maxHeight: "calc(92dvh - var(--edp-keyboard-offset, 0px))",
          paddingBottom:
            "calc(1.25rem + env(safe-area-inset-bottom) + var(--edp-keyboard-offset, 0px))",
        }}
      >
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-gray-900">Ký phiếu trực</div>
          <button
            className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
            onClick={() => {
              if (!signing) onClose()
            }}
          >
            Đóng
          </button>
        </div>

        <div className="mt-2 text-sm leading-6 text-gray-600">
          Nhập PIN Ban cán sự của lớp và chụp ảnh rõ mặt để xác nhận.
        </div>

        <div className="mt-4 max-h-[calc(92dvh-9rem)] space-y-3 overflow-y-auto pr-1">
          <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] text-gray-500">
              PIN Ban cán sự lớp {session.duty_class}
            </div>
            <input
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6)
                setPin(digits)
              }}
              className="mt-1 w-full bg-transparent text-[16px] font-semibold tracking-widest text-gray-900 outline-none"
              placeholder="Nhập PIN"
              onFocus={(e) => {
                e.currentTarget.scrollIntoView({
                  block: "center",
                  behavior: "smooth",
                })
              }}
            />
          </div>

          <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] text-gray-500">Ảnh xác nhận</div>
            <div className="mt-3">
              <CameraCapture value={photoFile} onChange={setPhotoFile} />
            </div>
          </div>

          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+var(--edp-keyboard-offset,0px))] rounded-[24px] bg-gradient-to-t from-white via-white to-white/90 pt-3">
            <button
              disabled={signing}
              onClick={() => void handleConfirm()}
              className="w-full min-h-14 rounded-2xl bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
            >
              {signing ? "Đang ký..." : "Xác nhận ký"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
