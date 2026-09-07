export function getApiErrorMessage(err: unknown, fallback: string) {
  const anyErr = err as any
  return (
    anyErr?.response?.data?.error ||
    anyErr?.response?.data?.message ||
    anyErr?.message ||
    fallback
  )
}

/** Returns a concise, non-secret diagnostic suitable for a development toast. */
export function getApiErrorDebugMessage(error: unknown) {
  const candidate = error as {
    code?: unknown
    message?: unknown
    response?: {
      status?: unknown
      data?: { error?: unknown; message?: unknown; code?: unknown }
    }
  } | null
  const status = Number(candidate?.response?.status)
  const responseCode = String(candidate?.response?.data?.code || "").trim()
  const errorCode = responseCode || String(candidate?.code || "").trim()
  const serverMessage = String(candidate?.response?.data?.error || candidate?.response?.data?.message || "").trim()
  const localMessage = String(candidate?.message || "").trim()
  const parts: string[] = []
  if (Number.isFinite(status) && status > 0) parts.push(`HTTP ${status}`)
  if (errorCode) parts.push(errorCode)
  if (serverMessage && serverMessage !== localMessage) parts.push(serverMessage)
  if (!parts.length && localMessage) parts.push(localMessage)
  return parts.length ? `Mã lỗi: ${parts.join(" · ")}` : "Mã lỗi: UNKNOWN_SIGN_ERROR"
}
