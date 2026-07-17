const express = require("express")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const {
  listAvailableGeminiModels,
  testGeminiConnection,
} = require("../ai/gemini")
const SystemSettingService = require("./service")

const router = express.Router()

const SUPPORTED_AI_PROVIDERS = ["gemini", "openai", "openrouter", "claude", "deepseek"]

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN
  return Number(value)
}

function validateSettingsPayload(payload) {
  const settings = payload?.settings

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    const error = new Error("Invalid settings payload")
    error.status = 400
    throw error
  }

  const normalized = {}

  if ("ai_provider" in settings) {
    const provider = String(settings.ai_provider || "").trim().toLowerCase()
    if (!SUPPORTED_AI_PROVIDERS.includes(provider)) {
      const error = new Error("Nhà cung cấp AI không hợp lệ")
      error.status = 400
      throw error
    }
    normalized.ai_provider = provider
  }

  if ("ai_model" in settings) {
    const model = String(settings.ai_model || "").trim()
    if (!model) {
      const error = new Error("Model AI không hợp lệ")
      error.status = 400
      throw error
    }
    normalized.ai_model = model
  }

  if ("temperature" in settings) {
    const temperature = toNumber(settings.temperature)
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      const error = new Error("Temperature phải nằm trong khoảng 0 đến 2")
      error.status = 400
      throw error
    }
    normalized.temperature = String(temperature)
  }

  if ("max_output_tokens" in settings) {
    const maxOutputTokens = toNumber(settings.max_output_tokens)
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      const error = new Error("Max Output Tokens phải là số nguyên dương")
      error.status = 400
      throw error
    }
    normalized.max_output_tokens = String(maxOutputTokens)
  }

  if ("gemini_api_key" in settings) {
    const apiKey = String(settings.gemini_api_key || "").trim()
    normalized.gemini_api_key = apiKey
  }

  if ("base_score" in settings) {
    const baseScore = toNumber(settings.base_score)
    if (!Number.isFinite(baseScore) || baseScore < 0) {
      const error = new Error("Điểm gốc mỗi lớp phải lớn hơn hoặc bằng 0")
      error.status = 400
      throw error
    }
    normalized.base_score = String(baseScore)
  }

  if (Object.keys(normalized).length === 0) {
    const error = new Error("Không có cấu hình nào để cập nhật")
    error.status = 400
    throw error
  }

  return normalized
}

function validateAiConnectionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("Invalid AI connection payload")
    error.status = 400
    throw error
  }

  const provider = String(payload.provider || "").trim().toLowerCase()
  const apiKey = String(payload.apiKey || "").trim()

  if (!SUPPORTED_AI_PROVIDERS.includes(provider)) {
    const error = new Error("Nhà cung cấp AI không hợp lệ")
    error.status = 400
    throw error
  }

  if (!apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  return { provider, apiKey }
}

function validateAiSettingsPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("Invalid AI settings payload")
    error.status = 400
    throw error
  }

  const provider = String(payload.provider || "").trim().toLowerCase()
  const apiKey = String(payload.apiKey || "").trim()
  const model = String(payload.model || "").trim()
  const temperature = toNumber(payload.temperature)
  const maxOutputTokens = toNumber(payload.max_output_tokens)

  if (!SUPPORTED_AI_PROVIDERS.includes(provider)) {
    const error = new Error("Nhà cung cấp AI không hợp lệ")
    error.status = 400
    throw error
  }

  if (!apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  if (!model) {
    const error = new Error("Model AI không hợp lệ")
    error.status = 400
    throw error
  }

  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    const error = new Error("Temperature phải nằm trong khoảng 0 đến 2")
    error.status = 400
    throw error
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    const error = new Error("Max Output Tokens phải là số nguyên dương")
    error.status = 400
    throw error
  }

  return {
    ai_provider: provider,
    gemini_api_key: apiKey,
    ai_model: model,
    temperature: String(temperature),
    max_output_tokens: String(maxOutputTokens),
  }
}

function buildAiAdminErrorResponse(err) {
  return {
    success: false,
    provider: err?.provider || "Gemini",
    status: err?.aiStatus || err?.status || 500,
    message: err?.adminMessage || err?.publicMessage || err?.message || "AI unavailable",
    suggestion: err?.suggestion,
  }
}

router.get("/", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const settings = await SystemSettingService.getAdminSettingsView()
    res.json({ success: true, settings })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || "Internal error" })
  }
})

router.get("/ai/models", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const provider = String(req.query?.provider || "").trim()
    const apiKey = String(req.query?.apiKey || "").trim()
    const models =
      provider || apiKey
        ? await listAvailableGeminiModels({ provider, apiKey })
        : await listAvailableGeminiModels()
    res.json({ success: true, models })
  } catch (err) {
    console.error(err)
    const payload = buildAiAdminErrorResponse(err)
    res.status(payload.status || 500).json(payload)
  }
})

router.post("/ai/test-connection", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = validateAiConnectionPayload(req.body)
    const result = await testGeminiConnection(payload)
    res.json(result)
  } catch (err) {
    console.error(err)
    const payload = buildAiAdminErrorResponse(err)
    res.status(payload.status || 500).json(payload)
  }
})

router.put("/ai", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const updates = validateAiSettingsPayload(req.body)
    await SystemSettingService.update(updates, req.session.user?.username || "system")
    const settings = await SystemSettingService.getAdminSettingsView()
    res.json({ success: true, settings })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || "Internal error" })
  }
})

router.put("/", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const updates = validateSettingsPayload(req.body)
    await SystemSettingService.update(updates, req.session.user?.username || "system")
    const settings = await SystemSettingService.getAdminSettingsView()
    res.json({ success: true, settings })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || "Internal error" })
  }
})

router.post("/test-ai", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await testGeminiConnection()
    res.json(result)
  } catch (err) {
    console.error(err)
    const payload = buildAiAdminErrorResponse(err)
    res.status(payload.status || 500).json(payload)
  }
})

module.exports = router
