import { useMemo, useState } from "react"
import { usePageTitle } from "../utils/usePageTitle"

function getParam(name: string) {
  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get(name) || ""
}

function BrowserShell() {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      <div className="ml-3 truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        EduDiscipline Platform
      </div>
    </div>
  )
}

export default function OpenInBrowser() {
  usePageTitle("EDP | Mở bằng trình duyệt")

  const url = useMemo(() => getParam("u") || window.location.href, [])
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      window.prompt("Sao chép link bên dưới:", url)
    }
  }

  function openInBrowser() {
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl items-center">
        <div className="w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <BrowserShell />

          <div className="p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]">
              Không hỗ trợ WebView
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              Mở bằng trình duyệt
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Bạn đang mở trong WebView. Một số chức năng có thể bị hạn chế. Hãy mở trang này bằng trình duyệt Chrome.
            </p>

            <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Thao tác nhanh
              </div>
              <ol className="space-y-2 text-sm text-slate-700">
                <li className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#2e77df] shadow-sm ring-1 ring-slate-200">
                    1
                  </span>
                  <span>Nhấn nút mở bên dưới.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#2e77df] shadow-sm ring-1 ring-slate-200">
                    2
                  </span>
                  <span>Nếu cần, sao chép link để mở lại sau.</span>
                </li>
              </ol>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={openInBrowser}
                className="inline-flex items-center justify-center rounded-2xl bg-[#2e77df] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245fc0] active:translate-y-px"
              >
                Mở trình duyệt
              </button>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:translate-y-px"
              >
                {copied ? "Đã sao chép" : "Sao chép link"}
              </button>
            </div>

            <div className="mt-5 break-all rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
              {url}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
