import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import { api } from "./api/api"

export type Passkey = {
  id: number
  device_name: string
  transports: string[]
  created_at: string
  last_used_at: string | null
}

export class PasskeyRegistrationInProgressError extends Error {
  constructor() {
    super("Passkey registration is already in progress")
    this.name = "PasskeyRegistrationInProgressError"
  }
}

let registrationInProgress = false

export function isPasskeyRegistrationInProgressError(error: unknown) {
  return error instanceof PasskeyRegistrationInProgressError
}

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string }
}

export function supportsPasskeys() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window
}

export function getCurrentDeviceName() {
  const userAgent = window.navigator.userAgent
  const platform = (window.navigator as NavigatorWithUserAgentData).userAgentData?.platform || ""

  if (/iPhone/i.test(userAgent)) return "iPhone"
  if (/iPad/i.test(userAgent)) return "iPad"

  const pixel = userAgent.match(/Pixel(?:\s+[\w-]+)?/i)
  if (pixel) return pixel[0]

  const samsung = userAgent.match(/SM-[\w-]+/i)
  if (samsung) return `Samsung Galaxy (${samsung[0]})`
  if (/Android/i.test(userAgent)) return "Thiết bị Android"
  if (/Windows/i.test(platform) || /Windows/i.test(userAgent)) return "Windows Hello"
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent)) return "MacBook"
  return "Thiết bị không xác định"
}

export function getPasskeyErrorMessage(error: unknown, fallback: string, cancelledMessage = "Bạn đã hủy xác thực Passkey.") {
  const responseError = error as {
    response?: { data?: { error?: unknown; message?: unknown } }
    name?: string
  }
  const apiMessage = responseError.response?.data?.error || responseError.response?.data?.message

  if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage
  if (responseError.name === "NotAllowedError") return cancelledMessage
  if (responseError.name === "InvalidStateError") return "Thiết bị này đã được đăng ký Passkey."
  return fallback
}

export async function registerPasskey() {
  if (registrationInProgress) {
    throw new PasskeyRegistrationInProgressError()
  }

  if (!supportsPasskeys()) {
    throw new Error("Trình duyệt này chưa hỗ trợ Passkey.")
  }

  registrationInProgress = true
  try {
    const options = await api.post("/passkeys/register/options", {
      device_name: getCurrentDeviceName(),
    })
    const response = await startRegistration({ optionsJSON: options.data })
    return await api.post<{ success: boolean; passkey: Passkey }>("/passkeys/register/verify", { response })
  } finally {
    registrationInProgress = false
  }
}

export async function loginWithPasskey() {
  if (!supportsPasskeys()) {
    throw new Error("Trình duyệt này chưa hỗ trợ Passkey.")
  }

  const options = await api.post("/passkeys/login/options")
  const response = await startAuthentication({ optionsJSON: options.data })
  return api.post<{ success: boolean; role: string }>("/passkeys/login/verify", { response })
}
