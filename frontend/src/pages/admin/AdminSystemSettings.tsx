import { useEffect, useMemo, useState } from "react"
import { Navigate } from "react-router-dom"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import {
  AdminBreadcrumb,
  AdminHeroCard,
  AdminPageShell,
  AdminSectionCard,
} from "../../components/admin/AdminUi"
import { usePageTitle } from "../../utils/usePageTitle"

type SettingItem = {
  key: string
  description: string
  value?: string
  updated_at?: string | null
  updated_by?: string | null
}

type SettingsResponse = {
  success: boolean
  settings: Record<string, SettingItem>
}

type AiConfig = {
  id?: number
  provider: string
  providerLabel?: string
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  updatedAt?: string | null
  updatedBy?: string | null
}

type AiConfigResponse = {
  success: boolean
  config: AiConfig
  message?: string
}

type TestAiResponse = {
  success: boolean
  provider: string
  providerLabel?: string
  detectedProvider?: string | null
  baseUrl: string
  model?: string
  models?: string[]
  message?: string
  suggestion?: string
}

type ModelsResponse = {
  success: boolean
  provider: string
  providerLabel?: string
  baseUrl: string
  models: string[]
}

const providerOptions = [
  { value: "gemini", label: "Gemini" },
  { value: "groq", label: "Groq" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Tùy chỉnh" },
]

const providerBaseUrls: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
}

function detectProviderFromApiKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key) return null
  if (key.startsWith("gsk_")) return "groq"
  if (key.startsWith("sk-or-v1-")) return "openrouter"
  if (key.startsWith("sk-proj-") || key.startsWith("sk-")) return "openai"
  if (key.startsWith("AIza")) return "gemini"
  return null
}

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

function buildAiFingerprint(input: {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  temperature: string
}) {
  return JSON.stringify({
    provider: input.provider.trim().toLowerCase(),
    apiKey: input.apiKey.trim(),
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    temperature: input.temperature.trim(),
  })
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

  const [aiProvider, setAiProvider] = useState("custom")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [aiModel, setAiModel] = useState("")
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [temperature, setTemperature] = useState("0")
  const [baseScore, setBaseScore] = useState("100")
  const [schoolYear, setSchoolYear] = useState("2026-2027")
  const [useElectronicGradebook, setUseElectronicGradebook] = useState("1")
  const [lastTestFingerprint, setLastTestFingerprint] = useState("")
  const [testPassed, setTestPassed] = useState(false)

  const canAccess = user?.role === "admin"
  const detectedProvider = useMemo(() => detectProviderFromApiKey(apiKey), [apiKey])

  useEffect(() => {
    if (!canAccess) return
    void loadSettings()
  }, [canAccess])

  useEffect(() => {
    const nextFingerprint = buildAiFingerprint({
      provider: aiProvider,
      apiKey,
      baseUrl,
      model: aiModel,
      temperature,
    })

    if (lastTestFingerprint && nextFingerprint !== lastTestFingerprint) {
      setTestPassed(false)
    }
  }, [aiProvider, aiModel, apiKey, baseUrl, lastTestFingerprint, temperature])

  function applyAiConfig(config: AiConfig) {
    const nextProvider = config.provider || detectProviderFromApiKey(config.apiKey) || "custom"
    const nextBaseUrl = config.baseUrl || providerBaseUrls[nextProvider] || ""
    const nextModel = config.model || ""
    const nextTemperature = String(config.temperature ?? 0)

    setAiProvider(nextProvider)
    setApiKey(config.apiKey || "")
    setBaseUrl(nextBaseUrl)
    setAiModel(nextModel)
    setTemperature(nextTemperature)
    setModelOptions(mergeModelOptions([], nextModel))
    setTestPassed(false)
    setLastTestFingerprint("")
  }

  async function loadSettings() {
    try {
      setPageLoading(true)
      setError(null)
      setNotice(null)

      const [settingsRes, aiRes] = await Promise.all([
        api.get<SettingsResponse>("/system-settings"),
        api.get<AiConfigResponse>("/system-settings/ai"),
      ])

      setBaseScore(settingsRes.data.settings.base_score?.value || "100")
      setSchoolYear(settingsRes.data.settings.school_year?.value || "2026-2027")
      setUseElectronicGradebook(settingsRes.data.settings.use_electronic_gradebook?.value === "0" ? "0" : "1")
      applyAiConfig(aiRes.data.config)
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.message || err?.response?.data?.error || "Không tải được cấu hình hệ thống")
    } finally {
      setPageLoading(false)
    }
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value)

    const nextProvider = detectProviderFromApiKey(value)
    if (!nextProvider) {
      return
    }

    setAiProvider(nextProvider)
    setBaseUrl(providerBaseUrls[nextProvider] || "")
  }

  function handleProviderChange(value: string) {
    setAiProvider(value)
    if (value !== "custom") {
      setBaseUrl(providerBaseUrls[value] || "")
    }
  }

  function buildAiPayload() {
    return {
      provider: aiProvider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: aiModel.trim(),
      temperature: Number(temperature),
    }
  }

  async function testApi() {
    const payload = buildAiPayload()

    if (!payload.apiKey) {
      setError("Vui lòng nhập API Key trước khi kiểm tra.")
      return
    }

    try {
      setTesting(true)
      setError(null)
      setNotice(null)

      const res = await api.post<TestAiResponse>("/system-settings/ai/test-connection", payload)
      const nextProvider = res.data.provider || payload.provider || detectedProvider || "custom"
      const nextBaseUrl = res.data.baseUrl || payload.baseUrl || providerBaseUrls[nextProvider] || ""
      const nextModels = mergeModelOptions(res.data.models || [], res.data.model || payload.model)
      const nextModel = res.data.model || payload.model || nextModels[0] || ""
      const nextTemperature = String(payload.temperature)
      const nextFingerprint = buildAiFingerprint({
        provider: nextProvider,
        apiKey: payload.apiKey,
        baseUrl: nextBaseUrl,
        model: nextModel,
        temperature: nextTemperature,
      })

      setAiProvider(nextProvider)
      setBaseUrl(nextBaseUrl)
      setAiModel(nextModel)
      setModelOptions(nextModels)
      setTestPassed(true)
      setLastTestFingerprint(nextFingerprint)
      setNotice(res.data.message || "Kết nối AI thành công.")
    } catch (err: any) {
      console.error(err)
      setTestPassed(false)
      setLastTestFingerprint("")
      setError(
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        "Không thể kiểm tra kết nối AI.",
      )
    } finally {
      setTesting(false)
    }
  }

  async function refreshModelOptions() {
    const payload = buildAiPayload()

    if (!payload.apiKey) {
      setError("Vui lòng nhập API Key trước khi tải danh sách model.")
      return
    }

    try {
      setModelsLoading(true)
      setError(null)

      const res = await api.get<ModelsResponse>("/system-settings/ai/models", {
        params: {
          provider: payload.provider,
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
        },
      })

      const nextModels = mergeModelOptions(res.data.models || [], aiModel)
      setAiProvider(res.data.provider || payload.provider)
      setBaseUrl(res.data.baseUrl || payload.baseUrl)
      setModelOptions(nextModels)
      if (!aiModel && nextModels[0]) {
        setAiModel(nextModels[0])
      }
      setNotice("Đã làm mới danh sách model.")
    } catch (err: any) {
      console.error(err)
      setError(
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        "Không tải được danh sách model.",
      )
    } finally {
      setModelsLoading(false)
    }
  }

  async function saveAiSettings() {
    const payload = buildAiPayload()
    const fingerprint = buildAiFingerprint({
      provider: payload.provider,
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      model: payload.model,
      temperature: String(payload.temperature),
    })

    if (!payload.apiKey) {
      setError("Vui lòng nhập API Key trước khi lưu.")
      return false
    }

    if (!payload.model) {
      setError("Vui lòng chọn model trước khi lưu.")
      return false
    }

    if (!testPassed || fingerprint !== lastTestFingerprint) {
      setError("Vui lòng kiểm tra API thành công với cấu hình hiện tại trước khi lưu.")
      return false
    }

    try {
      setSaving(true)
      setError(null)
      setNotice(null)

      const res = await api.put<AiConfigResponse>("/system-settings/ai", payload)
      applyAiConfig(res.data.config)
      setModelOptions(mergeModelOptions(modelOptions, res.data.config.model))
      setNotice(res.data.message || "Đã lưu cấu hình AI.")
      return true
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.message || err?.response?.data?.error || "Không lưu được cấu hình AI.")
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
          school_year: schoolYear.trim(),
          use_electronic_gradebook: useElectronicGradebook,
        },
      })

      setBaseScore(res.data.settings.base_score?.value || baseScore)
      setSchoolYear(res.data.settings.school_year?.value || schoolYear)
      setUseElectronicGradebook(res.data.settings.use_electronic_gradebook?.value === "0" ? "0" : "1")
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
    if (detectedProvider) {
      return `Phát hiện từ API Key: ${providerOptions.find((item) => item.value === detectedProvider)?.label || detectedProvider}.`
    }

    if (aiProvider === "custom") {
      return "Không nhận diện được provider từ API Key. Bạn có thể chọn thủ công và nhập Base URL."
    }

    return "Provider hiện tại sẽ được dùng để lấy danh sách model và kiểm tra kết nối."
  }, [aiProvider, detectedProvider])

  if (loading) {
    return null
  }

  if (!canAccess) {
    return <Navigate to="/admin/dashboard" replace />
  }

  return (
    <AdminPageShell maxWidthClassName="max-w-6xl">
      <AdminBreadcrumb current="Cấu hình hệ thống" />

      <AdminHeroCard
        eyebrow="Quản trị"
        title="Cấu hình hệ thống"
        description="Quản lý cấu hình AI đang hoạt động và các tham số hệ thống mà không cần sửa mã nguồn."
        actions={
          <>
            {activeTab === "ai" && (
              <button
                onClick={() => void testApi()}
                disabled={testing || saving || pageLoading}
                className="min-h-11 rounded-[18px] border border-white/70 bg-white/72 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
              >
                {testing ? "Đang kiểm tra..." : "Kiểm tra API"}
              </button>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving || pageLoading || (activeTab === "ai" && !testPassed)}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </>
        }
      />

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

      <AdminSectionCard className="p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("ai")}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${activeTab === "ai" ? "bg-[#2e77df] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Cấu hình AI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("competition")}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${activeTab === "competition" ? "bg-[#2e77df] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Quy chế thi đua
          </button>
        </div>
      </AdminSectionCard>

      {pageLoading ? (
        <AdminSectionCard className="text-sm text-slate-600">Đang tải cấu hình...</AdminSectionCard>
      ) : activeTab === "ai" ? (
        <AdminSectionCard className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Cấu hình AI đang hoạt động</h2>
            <p className="mt-1 text-sm text-slate-500">
              Hệ thống chỉ lưu một cấu hình AI. Bạn cần Test API thành công trước khi Save.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <label className="space-y-2 lg:col-span-2">
              <span className="text-sm font-semibold text-slate-900">API Key</span>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                placeholder="Dán API Key tại đây"
              />
              <div className="text-xs text-slate-500">{aiProviderHelp}</div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-900">Provider</span>
              <select
                value={aiProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

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

            <label className="space-y-2 lg:col-span-2">
              <span className="text-sm font-semibold text-slate-900">Base URL</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                placeholder="https://api.example.com/v1"
              />
            </label>

            <div className="space-y-2 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">Model</span>
                <button
                  type="button"
                  onClick={() => void refreshModelOptions()}
                  disabled={modelsLoading || pageLoading || !apiKey.trim()}
                  className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-[#2e77df] transition active:scale-[0.98] disabled:opacity-60"
                >
                  {modelsLoading ? "Đang tải..." : "Làm mới danh sách"}
                </button>
              </div>

              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              >
                {!modelOptions.length ? (
                  <option value="">{modelsLoading ? "Đang tải model..." : "Chưa có model khả dụng"}</option>
                ) : (
                  modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>

              <div className="text-xs text-slate-500">
                Danh sách model sẽ được tải từ provider hiện tại sau khi Test API hoặc làm mới danh sách.
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_16px_30px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Luồng cấu hình</div>
                <div className="mt-1 text-xs text-slate-500">
                  1. Nhập API Key. 2. Test API để xác thực và tải model. 3. Chọn model. 4. Save cấu hình đang hoạt động.
                </div>
              </div>

              <div className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${testPassed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {testPassed ? "Đã test thành công" : "Chưa test cấu hình hiện tại"}
              </div>
            </div>
          </div>
        </AdminSectionCard>
      ) : (
        <AdminSectionCard className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Cấu hình thi đua</h2>
            <p className="mt-1 text-sm text-slate-500">Quản lý các tham số gốc cho hệ thống thi đua.</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-900">Năm học đang dùng</span>
              <input
                type="text"
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
                placeholder="2026-2027"
              />
              <div className="text-xs text-slate-500">
                Một database dùng một năm học. Học kỳ, tháng và tuần mới sẽ mặc định thuộc năm học này.
              </div>
            </label>

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

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-900">Áp dụng sổ đầu bài điện tử</span>
              <select
                value={useElectronicGradebook}
                onChange={(e) => setUseElectronicGradebook(e.target.value)}
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#2e77df]"
              >
                <option value="1">Có</option>
                <option value="0">Không</option>
              </select>
              <div className="text-xs text-slate-500">
                Nếu chọn Không, tổng kết tuần sẽ không bắt buộc upload đủ Excel sổ đầu bài khối 10, 11, 12.
              </div>
            </label>
          </div>
        </AdminSectionCard>
      )}
    </AdminPageShell>
  )
}
