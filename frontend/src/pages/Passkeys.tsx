import { useCallback, useEffect, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../api/api"
import { useAuth } from "../auth/AuthContext"
import Footer from "../components/Footer"
import ModalShell from "../components/ModalShell"
import Navbar from "../components/Navbar"
import {
  getPasskeyErrorMessage,
  isPasskeyRegistrationInProgressError,
  registerPasskey,
  supportsPasskeys,
  type Passkey,
} from "../passkeys"
import { usePageTitle } from "../utils/usePageTitle"

function PasskeyIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="3" />
      <path d="M10.1 12.9 20 3m-3 0h3v3m-7 4 2 2m1-5 2 2" />
    </svg>
  )
}

function formatDate(value: string | null) {
  if (!value) return "Chưa sử dụng"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN")
}

type PasskeyRowProps = {
  passkey: Passkey
  deleting: boolean
  onDelete: (passkey: Passkey) => void
}

function PasskeyMobileRow({ passkey, deleting, onDelete }: PasskeyRowProps) {
  return (
    <article className="rounded-[24px] border border-white/70 bg-white/78 p-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-[#eff6ff] text-[#2e77df]">
          <PasskeyIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-slate-900">{passkey.device_name}</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-slate-500">Ngày đăng ký</dt>
              <dd className="font-medium text-slate-700">{formatDate(passkey.created_at)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-slate-500">Lần sử dụng gần nhất</dt>
              <dd className="font-medium text-slate-700">{formatDate(passkey.last_used_at)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <button type="button" onClick={() => onDelete(passkey)} disabled={deleting} className="mt-4 min-h-11 w-full rounded-[18px] border border-rose-100 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
        {deleting ? "Đang xóa..." : "Xóa Passkey"}
      </button>
    </article>
  )
}

export default function Passkeys() {
  usePageTitle("EDP | Passkey")
  const { user, loading, isOffline } = useAuth()
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loadingPasskeys, setLoadingPasskeys] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [passkeyToDelete, setPasskeyToDelete] = useState<Passkey | null>(null)
  const registrationInProgress = useRef(false)
  const hasRegisteredPasskey = useRef(false)

  const loadPasskeys = useCallback(async (showError = true) => {
    try {
      setLoadingPasskeys(true)
      const response = await api.get<Passkey[]>("/passkeys")
      setPasskeys(response.data)
      return true
    } catch (err) {
      if (showError && !registrationInProgress.current && !hasRegisteredPasskey.current) {
        toast.error(getPasskeyErrorMessage(err, "Không thể tải danh sách Passkey."))
      }
      return false
    } finally {
      setLoadingPasskeys(false)
    }
  }, [])

  useEffect(() => {
    if (user && !isOffline) {
      void loadPasskeys()
      return
    }
    if (user) setLoadingPasskeys(false)
  }, [isOffline, loadPasskeys, user])

  async function registerNewDevice() {
    try {
      setRegistering(true)
      registrationInProgress.current = true
      const result = await registerPasskey()
      hasRegisteredPasskey.current = true
      setPasskeys((current) => [result.data.passkey, ...current])
      toast.success("Đăng ký Passkey thành công.")
      void loadPasskeys(false)
    } catch (err) {
      if (isPasskeyRegistrationInProgressError(err)) return
      toast.error(getPasskeyErrorMessage(err, "Không thể đăng ký Passkey.", "Bạn đã hủy đăng ký Passkey."))
    } finally {
      registrationInProgress.current = false
      setRegistering(false)
    }
  }

  async function confirmDelete() {
    if (!passkeyToDelete) return

    try {
      setDeletingId(passkeyToDelete.id)
      await api.delete(`/passkeys/${passkeyToDelete.id}`)
      setPasskeys((current) => current.filter((passkey) => passkey.id !== passkeyToDelete.id))
      toast.success("Đã xóa Passkey.")
      setPasskeyToDelete(null)
    } catch (err) {
      toast.error(getPasskeyErrorMessage(err, "Không thể xóa Passkey."))
    } finally {
      setDeletingId(null)
    }
  }

  if (!loading && !user) return <Navigate to="/login" replace />

  const passkeyUnavailable = !supportsPasskeys()

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)] text-slate-900">
      <Navbar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="edp-glass-panel rounded-[32px] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">Bảo mật tài khoản</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Passkey</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Đăng ký Passkey trên từng thiết bị để đăng nhập nhanh bằng vân tay, Face ID hoặc Windows Hello mà không cần nhập mật khẩu.
              </p>
            </div>
            <button type="button" onClick={() => void registerNewDevice()} disabled={registering || isOffline || passkeyUnavailable} className="min-h-11 shrink-0 rounded-[18px] bg-[#2e77df] px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              {registering ? "Đang đăng ký..." : "Đăng ký Passkey"}
            </button>
          </div>

          {(passkeyUnavailable || isOffline) && (
            <div className="mt-5 rounded-[20px] border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {passkeyUnavailable
                ? "Trình duyệt này chưa hỗ trợ Passkey. Hãy mở EDP bằng trình duyệt hiện đại trên thiết bị của bạn."
                : "Bạn cần kết nối Internet để quản lý Passkey."}
            </div>
          )}
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-[#eff6ff] text-[#2e77df]">
              <PasskeyIcon />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">Thiết bị đã đăng ký</h2>
              <p className="mt-1 text-sm text-slate-500">Mỗi Passkey chỉ có thể được xóa bởi tài khoản đã đăng ký.</p>
            </div>
          </div>

          {loadingPasskeys ? (
            <div className="mt-6 flex min-h-40 items-center justify-center rounded-[28px] border border-white/70 bg-white/78 px-5 text-sm font-medium text-slate-500 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
              Đang tải danh sách Passkey...
            </div>
          ) : passkeys.length === 0 ? (
            <div className="mt-6 flex min-h-56 flex-col items-center justify-center rounded-[28px] border border-white/70 bg-white/78 px-5 py-8 text-center shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#eff6ff] text-[#2e77df]">
                <PasskeyIcon className="h-8 w-8" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">Bạn chưa đăng ký Passkey</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Đăng ký Passkey để đăng nhập nhanh bằng vân tay, Face ID hoặc Windows Hello mà không cần nhập mật khẩu.
              </p>
              <button type="button" onClick={() => void registerNewDevice()} disabled={registering || isOffline || passkeyUnavailable} className="mt-5 min-h-11 rounded-[18px] bg-[#2e77df] px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                {registering ? "Đang đăng ký..." : "Đăng ký Passkey"}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 hidden overflow-hidden rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_36px_rgba(15,23,42,0.06)] md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/90 text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Thiết bị</th>
                      <th className="px-5 py-4 font-semibold">Ngày đăng ký</th>
                      <th className="px-5 py-4 font-semibold">Lần sử dụng gần nhất</th>
                      <th className="px-5 py-4 text-right font-semibold">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {passkeys.map((passkey) => (
                      <tr key={passkey.id}>
                        <td className="px-5 py-4 font-semibold text-slate-900">{passkey.device_name}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDate(passkey.created_at)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDate(passkey.last_used_at)}</td>
                        <td className="px-5 py-4 text-right">
                          <button type="button" onClick={() => setPasskeyToDelete(passkey)} disabled={deletingId === passkey.id} className="min-h-10 rounded-[16px] border border-rose-100 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                            {deletingId === passkey.id ? "Đang xóa..." : "Xóa Passkey"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-3 md:hidden">
                {passkeys.map((passkey) => (
                  <PasskeyMobileRow key={passkey.id} passkey={passkey} deleting={deletingId === passkey.id} onDelete={setPasskeyToDelete} />
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      <Footer />

      {passkeyToDelete && (
        <ModalShell className="edp-glass-panel edp-spring-in max-w-md p-6 sm:p-7" onClose={deletingId ? undefined : () => setPasskeyToDelete(null)}>
          <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-rose-50 text-rose-700">
            <PasskeyIcon />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-slate-900">Xóa Passkey</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Bạn có chắc muốn xóa Passkey của thiết bị <span className="font-semibold text-slate-800">{passkeyToDelete.device_name}</span>? Bạn vẫn có thể đăng nhập bằng mật khẩu.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setPasskeyToDelete(null)} disabled={deletingId !== null} className="min-h-11 rounded-[18px] border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              Hủy
            </button>
            <button type="button" onClick={() => void confirmDelete()} disabled={deletingId !== null} className="min-h-11 rounded-[18px] bg-rose-600 px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(225,29,72,0.2)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              {deletingId ? "Đang xóa..." : "Xác nhận"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
