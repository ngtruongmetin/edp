const SystemSettingService = require("../system-settings/service")

let GoogleGenAIClass = null
let cachedClient = null
let cachedApiKey = null

const isDevelopment = process.env.NODE_ENV !== "production"
const FALLBACK_GEMINI_MODEL = "gemini-flash-lite-latest"
const GEMINI_PROVIDER = "Gemini"

async function getGoogleGenAIClass() {
  if (GoogleGenAIClass) {
    return GoogleGenAIClass
  }

  const mod = await import("@google/genai")
  GoogleGenAIClass = mod.GoogleGenAI
  return GoogleGenAIClass
}

async function getClient(apiKey) {
  if (cachedClient && cachedApiKey === apiKey) {
    return cachedClient
  }

  const GoogleGenAI = await getGoogleGenAIClass()
  cachedClient = new GoogleGenAI({ apiKey })
  cachedApiKey = apiKey
  return cachedClient
}

function createAiUnavailableError(message = "AI unavailable", cause = undefined, meta = {}) {
  const error = new Error(message)
  error.status = meta.httpStatus || 500
  error.aiStatus = meta.aiStatus || error.status
  error.aiUnavailable = true
  error.publicMessage = message
  error.adminMessage = meta.adminMessage || message
  error.provider = meta.provider || GEMINI_PROVIDER
  error.suggestion = meta.suggestion

  if (cause !== undefined) {
    error.cause = cause
  }

  return error
}

function logGeminiError(err) {
  if (!isDevelopment) return

  console.error("===== GEMINI ERROR =====")
  console.error("message:", err?.message ?? null)
  console.error("status:", err?.status ?? err?.response?.status ?? null)
  console.error("code:", err?.code ?? null)
  console.error("details:", err?.details ?? null)
  console.error("response:", err?.response ?? null)
  console.error("cause:", err?.cause ?? null)
  console.error("stack:", err?.stack ?? null)
  console.error("=======================")
}

function normalizeModelName(name) {
  const raw = String(name || "").trim()
  if (!raw) return ""
  if (raw.startsWith("models/")) {
    return raw.slice("models/".length)
  }
  const marker = "/models/"
  const markerIndex = raw.lastIndexOf(marker)
  if (markerIndex >= 0) {
    return raw.slice(markerIndex + marker.length)
  }
  const parts = raw.split("/")
  return parts[parts.length - 1] || raw
}

function toLower(value) {
  return String(value || "").toLowerCase()
}

function getErrorStatus(err) {
  const candidates = [
    err?.status,
    err?.response?.status,
    err?.cause?.status,
    err?.response?.data?.error?.code,
  ]

  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

function isTimeoutError(err) {
  const status = getErrorStatus(err)
  if (status === 504) return true

  const code = toLower(err?.code)
  const message = toLower(err?.message)

  return [
    code.includes("timeout"),
    code.includes("timedout"),
    code === "aborterror",
    message.includes("timeout"),
    message.includes("timed out"),
    message.includes("deadline exceeded"),
    message.includes("econnreset"),
    message.includes("fetch failed"),
    message.includes("network error"),
  ].some(Boolean)
}

function isInvalidApiKeyError(err) {
  const status = getErrorStatus(err)
  const message = toLower(err?.message)

  return (
    status === 401 ||
    status === 403 ||
    message.includes("api key not valid") ||
    message.includes("invalid api key") ||
    message.includes("permission denied")
  )
}

function isQuotaError(err) {
  const status = getErrorStatus(err)
  const message = toLower(err?.message)

  return (
    status === 429 ||
    message.includes("quota") ||
    message.includes("resource exhausted") ||
    message.includes("rate limit")
  )
}

function isModelUnavailableError(err, model) {
  const status = getErrorStatus(err)
  const message = toLower(err?.message)
  const normalizedModel = toLower(normalizeModelName(model))

  return (
    status === 404 ||
    message.includes("not_found") ||
    message.includes("no longer available") ||
    message.includes("not available to new users") ||
    message.includes("deprecated") ||
    message.includes("retired") ||
    (normalizedModel && message.includes(normalizedModel))
  )
}

function mapGeminiError(err, model) {
  const normalizedModel = normalizeModelName(model)
  const status = getErrorStatus(err) || 500

  if (isModelUnavailableError(err, normalizedModel)) {
    return createAiUnavailableError(
      "Mô hình AI hiện tại không còn được hỗ trợ. Vui lòng chọn model khác.",
      err,
      {
        httpStatus: 500,
        aiStatus: 404,
        adminMessage: normalizedModel
          ? `Model '${normalizedModel}' không còn khả dụng.`
          : "Mô hình AI hiện tại không còn khả dụng.",
        suggestion: "Hãy chọn model khác trong Cấu hình hệ thống.",
      },
    )
  }

  if (isInvalidApiKeyError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 401,
      adminMessage: "API Key không hợp lệ.",
      suggestion: "Hãy kiểm tra lại Gemini API Key trong Cấu hình hệ thống.",
    })
  }

  if (isQuotaError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 429,
      adminMessage: "Đã vượt quá giới hạn sử dụng Gemini.",
      suggestion: "Hãy thử lại sau hoặc sử dụng API Key khác.",
    })
  }

  if (isTimeoutError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 504,
      adminMessage: "Không thể kết nối tới Gemini.",
      suggestion: "Hãy thử lại sau ít phút.",
    })
  }

  return createAiUnavailableError("AI unavailable", err, {
    httpStatus: 500,
    aiStatus: status,
    adminMessage: String(err?.message || "AI unavailable"),
  })
}

async function getGeminiRuntimeConfig() {
  const config = await SystemSettingService.getAiRuntimeConfig()

  if (!config.apiKey) {
    throw createAiUnavailableError("AI unavailable", undefined, {
      httpStatus: 500,
      aiStatus: 400,
      adminMessage: "Chưa cấu hình Gemini API Key.",
      suggestion: "Hãy nhập Gemini API Key trong Cấu hình hệ thống.",
    })
  }

  if (config.provider !== "gemini") {
    throw createAiUnavailableError("AI unavailable", undefined, {
      httpStatus: 500,
      aiStatus: 400,
      adminMessage: "Nhà cung cấp AI hiện tại không phải Gemini.",
    })
  }

  return {
    ...config,
    model: normalizeModelName(config.model) || FALLBACK_GEMINI_MODEL,
  }
}

async function generateContentText(prompt) {
  const config = await getGeminiRuntimeConfig()

  try {
    const client = await getClient(config.apiKey)
    const response = await client.models.generateContent({
      model: config.model,
      contents: prompt,
      config: {
        temperature: Number.isFinite(config.temperature) ? config.temperature : 0,
        maxOutputTokens: Number.isInteger(config.maxOutputTokens)
          ? config.maxOutputTokens
          : 2048,
        responseMimeType: "application/json",
      },
    })

    const text = String(response?.text || "").trim()
    if (!text) {
      throw new Error("Empty Gemini response")
    }

    return {
      text,
      model: config.model,
      provider: GEMINI_PROVIDER,
    }
  } catch (err) {
    if (err?.aiUnavailable) {
      throw err
    }

    logGeminiError(err)
    throw mapGeminiError(err, config.model)
  }
}

function supportsGenerateContent(model) {
  const actions = Array.isArray(model?.supportedActions)
    ? model.supportedActions.map((item) => toLower(item))
    : []

  if (actions.length === 0) {
    return true
  }

  return actions.some((action) => action.includes("generatecontent"))
}

async function listAvailableGeminiModels() {
  const config = await getGeminiRuntimeConfig()

  try {
    const client = await getClient(config.apiKey)
    const pager = await client.models.list({
      config: {
        pageSize: 100,
        queryBase: true,
      },
    })

    const uniqueNames = new Set()
    const models = []

    for await (const model of pager) {
      if (!supportsGenerateContent(model)) continue

      const normalizedName = normalizeModelName(model?.name)
      if (!normalizedName || uniqueNames.has(normalizedName)) continue

      uniqueNames.add(normalizedName)
      models.push(normalizedName)
    }

    models.sort((a, b) => a.localeCompare(b))
    return models
  } catch (err) {
    if (err?.aiUnavailable) {
      throw err
    }

    logGeminiError(err)
    throw mapGeminiError(err, config.model)
  }
}

async function testGeminiConnection() {
  const result = await generateContentText([
    "Chỉ trả về JSON hợp lệ.",
    '{"violations":[]}',
  ].join("\n"))

  return {
    success: true,
    provider: result.provider,
    model: result.model,
    message: `Kết nối AI thành công với model '${result.model}'.`,
  }
}

async function generateViolationJson(prompt) {
  const result = await generateContentText(prompt)
  return result.text
}

module.exports = {
  createAiUnavailableError,
  generateViolationJson,
  listAvailableGeminiModels,
  testGeminiConnection,
}
