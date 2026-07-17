const repository = require("./configRepository")
const {
  createProvider,
  detectProviderConfig,
  detectProviderFromApiKey,
  getDefaultBaseUrl,
  getProviderLabel,
  normalizeBaseUrl,
  normalizeProviderName,
} = require("./providerFactory")

const DEFAULT_TEMPERATURE = 0
const DEFAULT_MAX_OUTPUT_TOKENS = 2048

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN
  return Number(value)
}

function normalizeTemperature(value, fallback = DEFAULT_TEMPERATURE) {
  const parsed = toNumber(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function normalizeRow(row) {
  if (!row) {
    return {
      id: 1,
      provider: "",
      apiKey: "",
      baseUrl: "",
      model: "",
      temperature: DEFAULT_TEMPERATURE,
      updatedAt: null,
      updatedBy: null,
    }
  }

  return {
    id: Number(row.id || 1),
    provider: normalizeProviderName(row.provider),
    apiKey: String(row.api_key || ""),
    baseUrl: normalizeBaseUrl(row.base_url),
    model: String(row.model || "").trim(),
    temperature: normalizeTemperature(row.temperature),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  }
}

function normalizeInput(input = {}) {
  const providerConfig = detectProviderConfig({
    provider: input.provider,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  })

  return {
    provider: providerConfig.provider,
    providerLabel: getProviderLabel(providerConfig.provider),
    detectedProvider: detectProviderFromApiKey(input.apiKey),
    apiKey: String(input.apiKey || "").trim(),
    baseUrl: providerConfig.baseUrl,
    model: String(input.model || "").trim(),
    temperature: normalizeTemperature(input.temperature),
    maxOutputTokens: Number.isInteger(Number(input.maxOutputTokens))
      ? Number(input.maxOutputTokens)
      : DEFAULT_MAX_OUTPUT_TOKENS,
  }
}

function validateTemperature(temperature) {
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    const error = new Error("Temperature phải nằm trong khoảng 0 đến 2")
    error.status = 400
    throw error
  }
}

function validateSavePayload(config) {
  if (!config.apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  if (!config.provider) {
    const error = new Error("Provider không hợp lệ")
    error.status = 400
    throw error
  }

  if (!config.baseUrl && config.provider !== "gemini") {
    const error = new Error("Base URL không được để trống")
    error.status = 400
    throw error
  }

  if (!config.model) {
    const error = new Error("Model không được để trống")
    error.status = 400
    throw error
  }

  validateTemperature(config.temperature)
}

async function getCurrentConfig() {
  const row = await repository.findCurrent()
  const config = normalizeRow(row)

  if (!config.provider && config.apiKey) {
    config.provider = detectProviderFromApiKey(config.apiKey) || "custom"
  }

  if (!config.baseUrl) {
    config.baseUrl = getDefaultBaseUrl(config.provider)
  }

  return {
    ...config,
    providerLabel: getProviderLabel(config.provider),
  }
}

async function getRuntimeConfig() {
  const config = await getCurrentConfig()
  if (!config.apiKey) {
    const error = new Error("Chưa cấu hình AI API Key.")
    error.status = 500
    error.aiUnavailable = true
    error.publicMessage = "Chưa cấu hình AI API Key."
    error.adminMessage = "Chưa cấu hình AI API Key."
    error.provider = config.providerLabel || "AI"
    throw error
  }

  return {
    provider: config.provider || detectProviderFromApiKey(config.apiKey) || "custom",
    providerLabel: getProviderLabel(config.provider),
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || getDefaultBaseUrl(config.provider),
    model: config.model,
    temperature: normalizeTemperature(config.temperature),
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  }
}

async function listModels(input = {}) {
  const source =
    input.apiKey || input.provider || input.baseUrl
      ? normalizeInput(input)
      : await getRuntimeConfig()

  if (!source.apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  const provider = createProvider(source.provider, {
    baseUrl: source.baseUrl,
  })
  const models = await provider.listModels({
    apiKey: source.apiKey,
    baseUrl: source.baseUrl,
  })

  return {
    provider: source.provider,
    providerLabel: getProviderLabel(source.provider),
    baseUrl: source.baseUrl || getDefaultBaseUrl(source.provider),
    models,
  }
}

async function testConnection(input = {}) {
  const config = normalizeInput(input)

  if (!config.apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  validateTemperature(config.temperature)

  const provider = createProvider(config.provider, {
    baseUrl: config.baseUrl,
  })

  const result = await provider.testConnection({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
  })

  return {
    success: true,
    provider: result.provider,
    providerLabel: result.providerLabel,
    detectedProvider: config.detectedProvider,
    baseUrl: result.baseUrl || getDefaultBaseUrl(result.provider),
    model: result.model || config.model,
    models: Array.isArray(result.models) ? result.models : [],
    message: result.message || "Kết nối AI thành công.",
  }
}

async function saveConfig(input, updatedBy = "system") {
  const config = normalizeInput(input)
  validateSavePayload(config)

  const saved = await repository.upsert({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || getDefaultBaseUrl(config.provider),
    model: config.model,
    temperature: config.temperature,
    updatedAt: new Date().toISOString(),
    updatedBy,
  })

  return normalizeRow(saved)
}

module.exports = {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TEMPERATURE,
  detectProviderFromApiKey,
  getCurrentConfig,
  getDefaultBaseUrl,
  getProviderLabel,
  getRuntimeConfig,
  listModels,
  normalizeInput,
  saveConfig,
  testConnection,
}
