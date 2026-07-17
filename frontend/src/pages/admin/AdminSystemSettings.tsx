import { useEffect, useMemo, useState } from "react"
import { Link, Navigate } from "react-router-dom"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type SettingItem = {
  key: string
  description: string
  value?: string
  has_value?: boolean
  masked_value?: string
  updated_at?: string | null
  updated_by?: string | null
}

type SettingsResponse = {
  success: boolean
  settings: Record<string, SettingItem>
}

type TestAiResponse = {
  success: boolean
  provider?: string
  status?: number
  message?: string
  suggestion?: string
  model?: string | null
  models?: string[]
}

const providerOptions = [
  { value: "gemini", label: "Gemini", enabled: true },
  { value: "openai", label: "OpenAI", enabled: false },
  { value: "openrouter", label: "OpenRouter", enabled: false },
  { value: "claude", label: "Claude", enabled: false },
  { value: "deepseek", label: "DeepSeek", enabled: false },
]

function mergeModelOptions(models: string[], preferredModel?: string) {
  const merged = new Set<string>()
  const normalizedPreferred = String(preferredModel || "").trim()

  if (normalizedPreferred) {
    merged.add(normalizedPreferred)
  }

  for (const model of models || []) {
    const normalizedModel = String(model || "").trim()
    if (!normalizedModel) continue
    merged.add(normalizedModel)
  }

  return Array.from(merged)
}

export default function AdminSystemSettings() {
  usePageTitle("EDP | Cấu hình hệ thống")
  const { user, loading } = useAuth()

  const [activeTab, setActiveTab] = useState<"ai" | "competition">("ai")
  const [pageLoading, setPageLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [aiProvider, setAiProvider] = useState("gemini")
  const [aiModel, setAiModel] = useState("")
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [temperature, setTemperature] = useState("0")
  const [maxOutputTokens, setMaxOutputTokens] = useState("2048")
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [maskedGeminiApiKey, setMaskedGeminiApiKey] = useState("")
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [baseScore, setBaseScore] = useState("100")

  const canAccess = user?.role === "admin"

  useEffect(() => {
    if (!canAccess) return
    void loadSettings()
  }, [canAccess])

  useEffect(() => {
    if (aiProvider !== "gemini") {
      setModelOptions(mergeModelOptions([], aiModel))
    }
  }, [aiModel, aiProvider])

  function applySettings(settings: Record<string, SettingItem>) {
    const savedProvider = settings.ai_provider?.value || "gemini"
    const savedModel = settings.ai_model?.value || ""

    setAiProvider(savedProvider)
    setAiModel(savedModel)
    setModelOptions(mergeModelOptions([], savedModel))
    setTemperature(settings.temperature?.value || "0")
    setMaxOutputTokens(settings.max_output_tokens?.value || "2048")
    setBaseScore(settings.base_score?.value || "100")
    setGeminiApiKey("")
    setMaskedGeminiApiKey(settings.gemini_api_key?.masked_value || "")
    setHasGeminiApiKey(Boolean(settings.gemini_api_key?.has_value))
  }

  async function loadSettings() {
    try {
      setPageLoading(true)
      setError(null)
      setNotice(null)

      const res = await api.get<SettingsResponse>("/system-settings")
      applySettings(res.data.settings)
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.error || "Không tải được cấu hình hệ thống")
    } finally {
      setPageLoading(false)
    }
  }

  function buildAiConnectionPayload() {
    return {
      provider: aiProvider,
      apiKey: geminiApiKey.trim(),
    }
  }

  function buildAiSavePayload() {
    return {
      provider: aiProvider,
      apiKey: geminiApiKey.trim(),
      model: aiModel.trim(),
      temperature: Number(temperature),
      max_output_tokens: Number(maxOutputTokens),
    }
  }

  async function runAiConnectionCheck(options?: {
    successMessage?: string
    silentErrors?: boolean
  }) {
    const payload = buildAiConnectionPayload()

    if (!payload.provider) {
      setError("Vui lòng chọn nhà cung cấp AI.")
      return null
    }

    if (!payload.apiKey) {
      setError("Vui lòng nhập API Key trước khi kiểm tra.")
      return null
    }

    try {
      setError(null)
      setNotice(null)

      const res = await api.post<TestAiResponse>("/system-settings/ai/test-connection", payload)
      const nextModels = mergeModelOptions(res.data.models || [], aiModel)

      setModelOptions(nextModels)

      if (!String(aiModel || "").trim() && nextModels[0]) {
        setAiModel(nextModels[0])
      }

      if (options?.successMessage) {
        setNotice(options.successMessage)
      } else if (res.data?.message) {
        setNotice(res.data.message)
      }

      return res.data
    } catch (err: any) {
      console.error(err)
      if (!options?.silentErrors) {
        setError(
          err?.response?.data?.message ||
            err?.response?.data?.error ||
            "Không thể kiểm tra API Key.",
        )
      }
      return null
    }
  }

  async function refreshModelOptions() {
    if (aiProvider !== "gemini") {
      setModelOptions(mergeModelOptions([], aiModel))
      return
    }

    try {
      setModelsLoading(true)
      await runAiConnectionCheck({
        successMessage: "Đã làm mới danh sách model.",
      })
    } finally {
      setModelsLoading(false)
    }
  }

  async function testApi() {
    try {
      setTesting(true)
      await runAiConnectionCheck({
        successMessage: "Kết nối AI thành công.",
      })
    } finally {
      setTesting(false)
    }
  }

  async function saveAiSettings() {
    const payload = buildAiSavePayload()

    if (!payload.provider) {
      setError("Vui lòng chọn nhà cung cấp AI.")
      return false
    }

    if (!payload.apiKey) {
      setError("Vui lòng nhập API Key trước khi lưu.")
      return false
    }

    if (!payload.model) {
      setError("Vui lòng chọn model trước khi lưu.")
      return false
    }

    try {
      setSaving(true)
      setError(null)
      setNotice(null)

      const res = await api.put<SettingsResponse>("/system-settings/ai", payload)
      applySettings(res.data.settings)
      setNotice("Đã lưu cấu hình AI.")
      return true
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.error || "Không lưu được cấu hình AI.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveCompetitionSettings() {
    try {
      setSaving(true)
      setError(null)
      setNotice(null)

      const res = await api.put<SettingsResponse>("/system-settings", {
        settings: {
          base_score: Number(baseScore),
        },
      })

      applySettings(res.data.settings)
      setNotice("Đã lưu cấu hình hệ thống.")
      return true
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.error || "Không lưu được cấu hình.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (activeTab === "ai") {
      await saveAiSettings()
      return
    }

    await saveCompetitionSettings()
  }

  const aiProviderHelp = useMemo(() => {
    if (aiProvider === "gemini") return "Gemini đang được hỗ trợ trong Phase 3."
    return "Nhà cung cấp này chưa được kích hoạt trong phiên bản hiện tại."
  }, [aiProvider])

  if (loading) {
    return null
  }

  if (!canAccess) {
    return <Navigate to="/admin/dashboard" replace />
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Cấu hình hệ thống</span>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-lg">
          <div className="px-8 py-7 flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] text-white/70">
                Admin
              </div>
              <h1 className="mt-2 text-3xl font-semibold">Cấu hình hệ thống</h1>
              <p className="mt-2 text-sm text-white/80">
                Quản lý cấu hình AI và tham số hệ thống mà không cần sửa `.env` trên server.
              </p>
            </div>

            <div className="lg:ml-auto flex flex-wrap gap-3">
              <button
                onClick={() => void handleSave()}
                disabled={saving || pageLoading}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#2e77df] shadow-sm transition active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
              <button
                onClick={() => void testApi()}
                disabled={testing || saving || pageLoading}
                className="rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                {testing ? "Đang kiểm tra..." : "Kiểm tra API"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-blue-50">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === "ai"
                  ? "bg-[#2e77df] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Cấu hình AI
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("competition")}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === "competition"
                  ? "bg-[#2e77df] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Quy chế thi đua
            </button>
          </div>
        </div>

        {pageLoading ? (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50 text-sm text-slate-600">
            Đang tải cấu hình...
          </div>
        ) : activeTab === "ai" ? (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Cấu hình AI</h2>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý nhà cung cấp AI, model, tham số sinh nội dung và API Key.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">Nhà cung cấp AI</span>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                >
                  {providerOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={!option.enabled}>
                      {option.label}
                      {option.enabled ? "" : " (sắp hỗ trợ)"}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-slate-500">{aiProviderHelp}</div>
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900">Model</span>
                  <button
                    type="button"
                    onClick={() => void refreshModelOptions()}
                    disabled={modelsLoading || pageLoading || aiProvider !== "gemini"}
                    className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-[#2e77df] transition active:scale-[0.98] disabled:opacity-60"
                  >
                    {modelsLoading ? "Đang tải..." : "Làm mới danh sách"}
                  </button>
                </div>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                  disabled={aiProvider !== "gemini"}
                >
                  {!modelOptions.length ? (
                    <option value="">
                      {modelsLoading ? "Đang tải model..." : "Chưa có model khả dụng"}
                    </option>
                  ) : (
                    modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))
                  )}
                </select>
                <div className="text-xs text-slate-500">
                  Danh sách model sẽ được tải sau khi API Key hiện tại được kiểm tra thành công.
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">Temperature</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">Max Output Tokens</span>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={maxOutputTokens}
                  onChange={(e) => setMaxOutputTokens(e.target.value)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                />
              </label>
            </div>

            <div className="rounded-3xl border border-blue-100 bg-slate-50/80 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Gemini API Key</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Khóa hiện tại: {hasGeminiApiKey ? maskedGeminiApiKey : "Chưa cấu hình"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowApiKey((current) => !current)}
                  className="ml-auto rounded-2xl border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition active:scale-[0.98]"
                >
                  {showApiKey ? "Ẩn" : "Hiện"}
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="flex-1 rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                  placeholder="Nhập API Key để kiểm tra và lưu"
                />
                <button
                  type="button"
                  onClick={() => void testApi()}
                  disabled={testing || saving || pageLoading}
                  className="rounded-2xl bg-[#2e77df] px-5 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
                >
                  {testing ? "Đang kiểm tra..." : "Kiểm tra API"}
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Nút kiểm tra sẽ dùng trực tiếp Provider và API Key đang nhập trên form, không lưu xuống database.
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Cấu hình thi đua</h2>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý các tham số gốc cho hệ thống thi đua.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">Điểm gốc mỗi lớp</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={baseScore}
                  onChange={(e) => setBaseScore(e.target.value)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                />
                <div className="text-xs text-slate-500">
                  Là số điểm mặc định của mỗi lớp khi bắt đầu tuần thi đua.
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
