const { createProvider, getProviderLabel } = require("./providerFactory")
const { getRuntimeConfig } = require("./configService")

const isDevelopment = process.env.NODE_ENV !== "production"

function createAiUnavailableError(message = "AI unavailable", cause = undefined, meta = {}) {
  const error = new Error(message)
  error.status = meta.httpStatus || 500
  error.aiStatus = meta.aiStatus || error.status
  error.aiUnavailable = true
  error.publicMessage = message
  error.adminMessage = meta.adminMessage || message
  error.provider = meta.provider || "AI"
  error.suggestion = meta.suggestion

  if (cause !== undefined) {
    error.cause = cause
  }

  return error
}

function logProviderError(err) {
  if (!isDevelopment) return

  console.error("===== AI PROVIDER ERROR =====")
  console.error("message:", err?.message ?? null)
  console.error("status:", err?.status ?? err?.response?.status ?? null)
  console.error("code:", err?.code ?? null)
  console.error("details:", err?.details ?? null)
  console.error("response:", err?.response ?? null)
  console.error("cause:", err?.cause ?? null)
  console.error("stack:", err?.stack ?? null)
  console.error("=============================")
}

function toLower(value) {
  return String(value || "").toLowerCase()
}

function getErrorStatus(err) {
  const candidates = [err?.status, err?.response?.status, err?.cause?.status]

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
    message.includes("incorrect api key") ||
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
  const normalizedModel = toLower(model)

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

function mapProviderError(err, config) {
  const status = getErrorStatus(err) || 500
  const providerLabel = config.providerLabel || getProviderLabel(config.provider)
  const model = String(config.model || "").trim()

  if (isModelUnavailableError(err, model)) {
    return createAiUnavailableError(
      "Mô hình AI hiện tại không còn được hỗ trợ. Vui lòng chọn model khác.",
      err,
      {
        httpStatus: 500,
        aiStatus: 404,
        adminMessage: model
          ? `Model '${model}' không còn khả dụng.`
          : "Mô hình AI hiện tại không còn khả dụng.",
        suggestion: "Hãy chọn model khác trong Cấu hình hệ thống.",
        provider: providerLabel,
      },
    )
  }

  if (isInvalidApiKeyError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 401,
      adminMessage: "API Key không hợp lệ.",
      suggestion: "Hãy kiểm tra lại API Key trong Cấu hình hệ thống.",
      provider: providerLabel,
    })
  }

  if (isQuotaError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 429,
      adminMessage: `Đã vượt quá giới hạn sử dụng ${providerLabel}.`,
      suggestion: "Hãy thử lại sau hoặc sử dụng API Key khác.",
      provider: providerLabel,
    })
  }

  if (isTimeoutError(err)) {
    return createAiUnavailableError("AI unavailable", err, {
      httpStatus: 500,
      aiStatus: 504,
      adminMessage: `Không thể kết nối tới ${providerLabel}.`,
      suggestion: "Hãy thử lại sau ít phút.",
      provider: providerLabel,
    })
  }

  return createAiUnavailableError("AI unavailable", err, {
    httpStatus: 500,
    aiStatus: status,
    adminMessage: String(err?.adminMessage || err?.message || "AI unavailable"),
    provider: providerLabel,
  })
}

async function generateViolationJson(prompt) {
  const config = await getRuntimeConfig()

  try {
    const provider = createProvider(config.provider, {
      baseUrl: config.baseUrl,
    })

    const result = await provider.generateText({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      prompt,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    })

    return String(result.text || "").trim()
  } catch (err) {
    if (err?.aiUnavailable) {
      throw err
    }

    logProviderError(err)
    throw mapProviderError(err, config)
  }
}

module.exports = {
  createAiUnavailableError,
  generateViolationJson,
}
