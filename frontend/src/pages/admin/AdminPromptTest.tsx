import { useState } from "react"
import { Navigate } from "react-router-dom"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type PreviewResponse = {
  success: boolean
  prompt?: string
}

export default function AdminPromptTest() {
  usePageTitle("EDP | Test Prompt")
  const { user, loading } = useAuth()

  const [message, setMessage] = useState("")
  const [prompt, setPrompt] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAccess = user?.role === "admin"

  async function handleGenerate() {
    const trimmed = message.trim()
    if (!trimmed) {
      setError("Vui lòng nhập message.")
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const res = await api.post<PreviewResponse>("/ai/codo/prompt-preview", {
        message: trimmed,
      })

      setPrompt(res.data?.prompt || "")
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.error || "Không thể tạo prompt.")
    } finally {
      setIsLoading(false)
    }
  }

  function handleDownload() {
    if (!prompt) return

    const blob = new Blob([prompt], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `edp_prompt_preview_${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return null
  }

  if (!canAccess) {
    return <Navigate to="/admin/dashboard" replace />
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
        <div className="rounded-3xl bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-lg">
          <div className="px-8 py-7">
            <div className="text-xs uppercase tracking-[0.2em] text-white/70">
              Admin
            </div>
            <h1 className="mt-2 text-3xl font-semibold">Test Prompt AI</h1>
            <p className="mt-2 text-sm text-white/80">
              Nhập message để xem prompt hoàn chỉnh và tải xuống file `.txt`.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50 space-y-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">Message</div>
              <div className="mt-1 text-sm text-slate-500">
                Dùng context demo của AI Cờ đỏ.
              </div>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              placeholder="Ví dụ: Đi trễ 2 bạn"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isLoading}
                className="rounded-2xl bg-[#2e77df] px-5 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
              >
                {isLoading ? "Đang tạo..." : "Tạo prompt"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!prompt}
                className="rounded-2xl border border-blue-100 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition active:scale-[0.98] disabled:opacity-50"
              >
                Tải TXT
              </button>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50 space-y-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">Prompt</div>
              <div className="mt-1 text-sm text-slate-500">
                Xem trước nội dung prompt đã build.
              </div>
            </div>

            <textarea
              value={prompt}
              readOnly
              rows={24}
              className="w-full rounded-2xl border border-blue-100 bg-slate-50 px-4 py-3 font-mono text-[12px] leading-6 outline-none"
              placeholder="Prompt sẽ hiển thị ở đây"
            />
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
