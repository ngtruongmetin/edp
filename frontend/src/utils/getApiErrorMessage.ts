export function getApiErrorMessage(err: unknown, fallback: string) {
  const anyErr = err as any
  return (
    anyErr?.response?.data?.error ||
    anyErr?.response?.data?.message ||
    anyErr?.message ||
    fallback
  )
}
