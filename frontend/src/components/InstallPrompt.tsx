import { useEffect, useState } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => setInstallEvent(null)

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)
    }
  }, [])

  if (!installEvent) return null

  const install = async () => {
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  return (
    <aside className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-xl" aria-label="Cài đặt ứng dụng">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">Cài EduDiscipline Platform</p>
        <p className="mt-1 text-sm text-slate-600">Mở nhanh hơn và dùng như ứng dụng trên điện thoại.</p>
      </div>
      <button type="button" onClick={() => void install()} className="shrink-0 rounded-xl bg-[#2e77df] px-3 py-2 text-sm font-semibold text-white hover:bg-[#245fc0]">
        Cài đặt
      </button>
      <button type="button" onClick={() => setInstallEvent(null)} className="shrink-0 rounded-xl px-2 py-2 text-sm text-slate-500 hover:bg-slate-100" aria-label="Đóng">
        Đóng
      </button>
    </aside>
  )
}
