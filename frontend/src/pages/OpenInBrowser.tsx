import { useMemo, useState } from "react"
import { usePageTitle } from "../utils/usePageTitle"

function getParam(name: string) {
  const sp = new URLSearchParams(window.location.search)
  return sp.get(name) || ""
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
      // Fallback for restricted webviews
      window.prompt("Sao chép link bên dưới:", url)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50">
        <div className="text-lg font-semibold text-gray-900">
          Mở bằng trình duyệt
        </div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          Bạn đang mở trong Zalo WebView. Một số chức năng có thể bị chặn. Hãy mở
          trang này bằng trình duyệt Chrome. Website được thiết kế để hoạt động tốt nhất trên Chrome.
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-gray-500">Hướng dẫn cụ thể</div>
          <ol className="mt-2 space-y-1 text-sm text-gray-700 list-decimal list-inside">
            <li>Nhấn dấu ba chấm ở góc trên</li>
            <li>Chọn “Mở bằng trình duyệt”</li>
          </ol>
        </div>

        <div className="mt-4 space-y-2">


          <button
            onClick={copyLink}
            className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 hover:bg-gray-50 transition"
          >
            {copied ? "Đã sao chép" : "Sao chép link"}
          </button>
        </div>

        <div className="mt-4 text-xs text-gray-500 break-all">
          {url}
        </div>
      </div>
    </div>
  )
}
