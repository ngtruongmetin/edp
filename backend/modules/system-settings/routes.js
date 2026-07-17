const express = require("express")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const {
  detectProviderFromApiKey,
  getCurrentConfig,
  getDefaultBaseUrl,
  getProviderLabel,
  listModels,
  saveConfig,
  testConnection,
} = require("../ai/configService")
const SystemSettingService = require("./service")

const router = express.Router()

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN
  return Number(value)
}

function buildAdminAiErrorResponse(err, fallbackProvider = "custom") {
  const provider = String(err?.provider || fallbackProvider || "custom").trim().toLowerCase()
  const label = getProviderLabel(provider)

  return {
    success: false,
    provider,
    providerLabel: label,
    status: err?.aiStatus || err?.status || 500,
    message: err?.adminMessage || err?.publicMessage || err?.message || "AI unavailable",
    suggestion: err?.suggestion,
  }
}

function validateGeneralSettingsPayload(payload) {
  const settings = payload?.settings

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    const error = new Error("Invalid settings payload")
    error.status = 400
    throw error
  }

  const normalized = {}

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

function normalizeAiPayload(payload = {}) {
  return {
    provider: String(payload.provider || "").trim().toLowerCase(),
    apiKey: String(payload.apiKey || "").trim(),
    baseUrl: String(payload.baseUrl || "").trim(),
    model: String(payload.model || "").trim(),
    temperature: payload.temperature,
  }
}

function validateAiTestPayload(payload) {
  const normalized = normalizeAiPayload(payload)

  if (!normalized.apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  return normalized
}

function validateAiSavePayload(payload) {
  const normalized = normalizeAiPayload(payload)
  const temperature = toNumber(payload.temperature)

  if (!normalized.apiKey) {
    const error = new Error("API Key không được để trống")
    error.status = 400
    throw error
  }

  if (!normalized.model) {
    const error = new Error("Model không được để trống")
    error.status = 400
    throw error
  }

  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    const error = new Error("Temperature phải nằm trong khoảng 0 đến 2")
    error.status = 400
    throw error
  }

  return {
    ...normalized,
    temperature,
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

router.put("/", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const updates = validateGeneralSettingsPayload(req.body)
    await SystemSettingService.update(updates, req.session.user?.username || "system")
    const settings = await SystemSettingService.getAdminSettingsView()
    res.json({ success: true, settings })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || "Internal error" })
  }
})

router.get("/ai", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const config = await getCurrentConfig()
    res.json({ success: true, config })
  } catch (err) {
    console.error(err)
    const payload = buildAdminAiErrorResponse(err)
    res.status(payload.status || 500).json(payload)
  }
})

router.get("/ai/models", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = normalizeAiPayload(req.query)
    const result = await listModels(payload)

    res.json({
      success: true,
      provider: result.provider,
      providerLabel: result.providerLabel,
      baseUrl: result.baseUrl,
      models: result.models,
    })
  } catch (err) {
    console.error(err)
    const payload = buildAdminAiErrorResponse(err, req.query?.provider)
    res.status(payload.status || 500).json(payload)
  }
})

router.post("/ai/test-connection", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = validateAiTestPayload(req.body)
    const result = await testConnection(payload)

    res.json({
      success: true,
      provider: result.provider,
      providerLabel: result.providerLabel,
      detectedProvider: result.detectedProvider || detectProviderFromApiKey(payload.apiKey),
      baseUrl: result.baseUrl || getDefaultBaseUrl(result.provider),
      model: result.model || "",
      models: result.models || [],
      message: result.message || "Kết nối AI thành công.",
    })
  } catch (err) {
    console.error(err)
    const payload = buildAdminAiErrorResponse(err, req.body?.provider || detectProviderFromApiKey(req.body?.apiKey))
    res.status(payload.status || 500).json(payload)
  }
})

router.put("/ai", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = validateAiSavePayload(req.body)
    const config = await saveConfig(payload, req.session.user?.username || "system")

    res.json({
      success: true,
      config: {
        ...config,
        providerLabel: getProviderLabel(config.provider),
      },
      message: "Đã lưu cấu hình AI.",
    })
  } catch (err) {
    console.error(err)
    const payload = buildAdminAiErrorResponse(err, req.body?.provider || detectProviderFromApiKey(req.body?.apiKey))
    res.status(payload.status || 500).json(payload)
  }
})

module.exports = router
