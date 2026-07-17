const DEFAULT_BASE_URLS = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
}

const PROVIDER_LABELS = {
  gemini: "Gemini",
  groq: "Groq",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  custom: "Tùy chỉnh",
}

const PROVIDER_PREFIXES = [
  { provider: "groq", prefixes: ["gsk_"] },
  { provider: "openrouter", prefixes: ["sk-or-v1-"] },
  { provider: "openai", prefixes: ["sk-proj-", "sk-"] },
  { provider: "gemini", prefixes: ["AIza"] },
]

const GENERIC_CHAT_MODEL = "gpt-4o-mini"
const GENERIC_TEST_PROMPT = "Trả lời đúng một từ: OK"

let GoogleGenAIClass = null

function normalizeProviderName(provider) {
  return String(provider || "").trim().toLowerCase()
}

function normalizeBaseUrl(baseUrl, fallback = "") {
  const raw = String(baseUrl || "").trim()
  if (!raw) return String(fallback || "").trim()
  return raw.replace(/\/+$/, "")
}

function detectProviderFromApiKey(apiKey) {
  const key = String(apiKey || "").trim()
  if (!key) return null

  for (const entry of PROVIDER_PREFIXES) {
    if (entry.prefixes.some((prefix) => key.startsWith(prefix))) {
      return entry.provider
    }
  }

  return null
}

function getProviderLabel(provider) {
  return PROVIDER_LABELS[normalizeProviderName(provider)] || "Tùy chỉnh"
}

function getDefaultBaseUrl(provider) {
  return DEFAULT_BASE_URLS[normalizeProviderName(provider)] || ""
}

function isOpenAICompatibleProvider(provider) {
  const normalized = normalizeProviderName(provider)
  return ["groq", "openai", "openrouter", "custom"].includes(normalized)
}

function getChatModelFallback(provider) {
  const normalized = normalizeProviderName(provider)
  if (normalized === "gemini") return "gemini-2.5-flash"
  return GENERIC_CHAT_MODEL
}

async function getGoogleGenAIClass() {
  if (GoogleGenAIClass) {
    return GoogleGenAIClass
  }

  const mod = await import("@google/genai")
  GoogleGenAIClass = mod.GoogleGenAI
  return GoogleGenAIClass
}

async function readJsonResponse(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function createHttpError(status, message, meta = {}) {
  const error = new Error(message)
  error.status = status
  error.code = meta.code || undefined
  error.details = meta.details
  error.response = meta.response
  error.cause = meta.cause
  error.provider = meta.provider
  error.adminMessage = meta.adminMessage || message
  error.publicMessage = meta.publicMessage || message
  error.suggestion = meta.suggestion
  return error
}

function buildOpenAIHeaders(apiKey, provider) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://edp.local"
    headers["X-Title"] = "EduDiscipline Platform"
  }

  return headers
}

async function fetchJson(url, options = {}, provider) {
  const response = await fetch(url, options)
  const body = await readJsonResponse(response)

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      body?.error ||
      body?.raw ||
      `HTTP ${response.status}`

    throw createHttpError(response.status, message, {
      code: body?.error?.code || body?.code,
      details: body,
      response: body,
      provider,
    })
  }

  return body
}

class BaseAIProvider {
  constructor({ provider, baseUrl }) {
    this.provider = normalizeProviderName(provider)
    this.baseUrl = normalizeBaseUrl(baseUrl, getDefaultBaseUrl(provider))
  }

  get label() {
    return getProviderLabel(this.provider)
  }

  resolveBaseUrl(baseUrl) {
    return normalizeBaseUrl(baseUrl, this.baseUrl)
  }

  resolveModel(model, models = []) {
    const requested = String(model || "").trim()
    if (requested) {
      return requested
    }

    const firstModel = Array.isArray(models) ? models[0] : ""
    if (firstModel) return String(firstModel)

    return getChatModelFallback(this.provider)
  }

  async listModels() {
    throw createHttpError(400, `Provider ${this.label} chưa hỗ trợ liệt kê model`, {
      provider: this.provider,
    })
  }

  async generateText() {
    throw createHttpError(400, `Provider ${this.label} chưa hỗ trợ generate text`, {
      provider: this.provider,
    })
  }

  async testConnection() {
    const models = await this.listModels()
    const model = this.resolveModel("", models)
    await this.generateText({
      apiKey: "",
      baseUrl: this.baseUrl,
      model,
      prompt: GENERIC_TEST_PROMPT,
      temperature: 0,
      maxOutputTokens: 16,
    })

    return {
      success: true,
      provider: this.provider,
      providerLabel: this.label,
      baseUrl: this.baseUrl,
      model,
      models,
      message: "Kết nối AI thành công.",
    }
  }
}

class OpenAICompatibleProvider extends BaseAIProvider {
  async listModels({ apiKey, baseUrl } = {}) {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl)
    if (!resolvedBaseUrl) {
      throw createHttpError(400, "Chưa có Base URL", { provider: this.provider })
    }

    const body = await fetchJson(
      `${resolvedBaseUrl}/models`,
      {
        method: "GET",
        headers: buildOpenAIHeaders(apiKey, this.provider),
      },
      this.provider,
    )

    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
    const models = []
    const seen = new Set()

    for (const item of data) {
      const id = String(item?.id || item?.name || "").trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      models.push(id)
    }

    models.sort((a, b) => a.localeCompare(b))
    return models
  }

  async generateText({
    apiKey,
    baseUrl,
    model,
    prompt,
    temperature = 0,
    maxOutputTokens = 256,
  }) {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl)
    if (!resolvedBaseUrl) {
      throw createHttpError(400, "Chưa có Base URL", { provider: this.provider })
    }

    const chosenModel = this.resolveModel(model)
    const body = await fetchJson(
      `${resolvedBaseUrl}/chat/completions`,
      {
        method: "POST",
        headers: buildOpenAIHeaders(apiKey, this.provider),
        body: JSON.stringify({
          model: chosenModel,
          messages: [{ role: "user", content: String(prompt || "") }],
          temperature: Number.isFinite(temperature) ? temperature : 0,
          max_tokens: Number.isInteger(maxOutputTokens) ? maxOutputTokens : 256,
        }),
      },
      this.provider,
    )

    const content = String(body?.choices?.[0]?.message?.content || "").trim()
    if (!content) {
      throw createHttpError(500, "Empty AI response", { provider: this.provider, response: body })
    }

    return {
      text: content,
      model: chosenModel,
      provider: this.provider,
      providerLabel: this.label,
      baseUrl: resolvedBaseUrl,
    }
  }

  async testConnection({ apiKey, baseUrl, model, temperature = 0 }) {
    const models = await this.listModels({ apiKey, baseUrl }).catch(() => [])
    const chosenModel = this.resolveModel(model, models)
    const result = await this.generateText({
      apiKey,
      baseUrl,
      model: chosenModel,
      prompt: GENERIC_TEST_PROMPT,
      temperature,
      maxOutputTokens: 16,
    })

    return {
      success: true,
      provider: this.provider,
      providerLabel: this.label,
      baseUrl: this.resolveBaseUrl(baseUrl),
      model: result.model,
      models,
      message: "Kết nối AI thành công.",
    }
  }
}

class GeminiProvider extends BaseAIProvider {
  async getClient(apiKey) {
    const GoogleGenAI = await getGoogleGenAIClass()
    return new GoogleGenAI({ apiKey })
  }

  async listModels({ apiKey } = {}) {
    if (!apiKey) {
      throw createHttpError(400, "Chưa có API Key", { provider: this.provider })
    }

    const client = await this.getClient(apiKey)
    const pager = await client.models.list({
      config: {
        pageSize: 100,
        queryBase: true,
      },
    })

    const models = []
    const seen = new Set()

    for await (const model of pager) {
      const actions = Array.isArray(model?.supportedActions)
        ? model.supportedActions.map((item) => String(item || "").toLowerCase())
        : []
      if (actions.length > 0 && !actions.some((action) => action.includes("generatecontent"))) {
        continue
      }

      const name = String(model?.name || "").trim()
      const normalized = name.replace(/^models\//, "").replace(/^.*\/models\//, "")
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      models.push(normalized)
    }

    models.sort((a, b) => a.localeCompare(b))
    return models
  }

  async generateText({
    apiKey,
    model,
    prompt,
    temperature = 0,
    maxOutputTokens = 256,
  }) {
    if (!apiKey) {
      throw createHttpError(400, "Chưa có API Key", { provider: this.provider })
    }

    const client = await this.getClient(apiKey)
    const chosenModel = this.resolveModel(model)
    const response = await client.models.generateContent({
      model: chosenModel,
      contents: String(prompt || ""),
      config: {
        temperature: Number.isFinite(temperature) ? temperature : 0,
        maxOutputTokens: Number.isInteger(maxOutputTokens) ? maxOutputTokens : 256,
      },
    })

    const text = String(response?.text || "").trim()
    if (!text) {
      throw createHttpError(500, "Empty AI response", {
        provider: this.provider,
        response,
      })
    }

    return {
      text,
      model: chosenModel,
      provider: this.provider,
      providerLabel: this.label,
      baseUrl: getDefaultBaseUrl(this.provider),
    }
  }

  async testConnection({ apiKey, model, temperature = 0 }) {
    const models = await this.listModels({ apiKey }).catch(() => [])
    const chosenModel = this.resolveModel(model, models)
    await this.generateText({
      apiKey,
      model: chosenModel,
      prompt: GENERIC_TEST_PROMPT,
      temperature,
      maxOutputTokens: 16,
    })

    return {
      success: true,
      provider: this.provider,
      providerLabel: this.label,
      baseUrl: getDefaultBaseUrl(this.provider),
      model: chosenModel,
      models,
      message: "Kết nối AI thành công.",
    }
  }
}

function createProvider(provider, options = {}) {
  const normalized = normalizeProviderName(provider)

  if (normalized === "gemini") {
    return new GeminiProvider({ provider: normalized, baseUrl: options.baseUrl })
  }

  if (isOpenAICompatibleProvider(normalized)) {
    return new OpenAICompatibleProvider({
      provider: normalized || "custom",
      baseUrl: options.baseUrl,
    })
  }

  throw createHttpError(400, "Nhà cung cấp AI không được hỗ trợ", {
    provider: normalized || "custom",
  })
}

function detectProviderConfig({ provider, apiKey, baseUrl } = {}) {
  const detectedProvider = normalizeProviderName(provider) || detectProviderFromApiKey(apiKey) || "custom"
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, getDefaultBaseUrl(detectedProvider))
  const effectiveProvider = normalizedBaseUrl || detectedProvider === "custom"
    ? detectedProvider
    : detectedProvider

  return {
    provider: effectiveProvider,
    baseUrl: normalizedBaseUrl,
  }
}

module.exports = {
  createProvider,
  detectProviderFromApiKey,
  detectProviderConfig,
  getDefaultBaseUrl,
  getProviderLabel,
  normalizeBaseUrl,
  normalizeProviderName,
}
