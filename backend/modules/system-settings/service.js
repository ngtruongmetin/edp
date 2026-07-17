const repository = require("./repository")

const SETTING_DEFINITIONS = {
  gemini_api_key: {
    key: "gemini_api_key",
    description: "API Key dùng để gọi Google Gemini",
    secret: true,
  },
  ai_provider: {
    key: "ai_provider",
    description: "Nhà cung cấp AI mặc định của hệ thống",
    secret: false,
  },
  ai_model: {
    key: "ai_model",
    description: "Model AI mặc định cho AI Assistant",
    secret: false,
  },
  temperature: {
    key: "temperature",
    description: "Temperature mặc định cho AI Assistant",
    secret: false,
  },
  max_output_tokens: {
    key: "max_output_tokens",
    description: "Giới hạn số token đầu ra của AI Assistant",
    secret: false,
  },
  base_score: {
    key: "base_score",
    description: "Điểm gốc mặc định của mỗi lớp khi bắt đầu tuần thi đua",
    secret: false,
  },
}

let settingsCache = null
let cachePromise = null

function normalizeRecord(row) {
  return {
    id: Number(row.id),
    setting_key: String(row.setting_key),
    setting_value: row.setting_value == null ? "" : String(row.setting_value),
    description: row.description == null ? "" : String(row.description),
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
  }
}

function buildCacheMap(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const normalized = normalizeRecord(row)
    map.set(normalized.setting_key, normalized)
  }
  return map
}

async function refreshCache() {
  const rows = await repository.getAll()
  settingsCache = buildCacheMap(rows)
  return settingsCache
}

async function ensureCacheLoaded() {
  if (settingsCache) {
    return settingsCache
  }

  if (!cachePromise) {
    cachePromise = refreshCache().finally(() => {
      cachePromise = null
    })
  }

  return cachePromise
}

function maskSecret(value) {
  const raw = String(value || "")
  if (!raw) return ""
  if (raw.length <= 4) {
    return "*".repeat(raw.length)
  }
  return `${"*".repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}`
}

async function findByKey(settingKey) {
  const cache = await ensureCacheLoaded()
  return cache.get(settingKey) || null
}

async function get(settingKey, fallback = null) {
  const record = await findByKey(settingKey)
  return record ? record.setting_value : fallback
}

async function getAll() {
  const cache = await ensureCacheLoaded()
  return Object.fromEntries(cache.entries())
}

async function set(settingKey, settingValue, updatedBy = "system") {
  const definition = SETTING_DEFINITIONS[settingKey]
  if (!definition) {
    const error = new Error(`Unknown setting key: ${settingKey}`)
    error.status = 400
    throw error
  }

  await repository.upsert({
    settingKey,
    settingValue: String(settingValue ?? ""),
    description: definition.description,
    updatedAt: new Date().toISOString(),
    updatedBy,
  })

  await refreshCache()
  return findByKey(settingKey)
}

async function update(values, updatedBy = "system") {
  const entries = Object.entries(values || {})
  for (const [settingKey, settingValue] of entries) {
    await set(settingKey, settingValue, updatedBy)
  }
  return getAll()
}

async function getAdminSettingsView() {
  const allSettings = await getAll()
  const output = {}

  for (const [settingKey, record] of Object.entries(allSettings)) {
    const definition = SETTING_DEFINITIONS[settingKey]
    if (!definition) continue

    output[settingKey] = {
      key: settingKey,
      description: definition.description,
      value: definition.secret ? "" : record.setting_value,
      has_value: definition.secret ? Boolean(record.setting_value) : undefined,
      masked_value: definition.secret ? maskSecret(record.setting_value) : undefined,
      updated_at: record.updated_at,
      updated_by: record.updated_by,
    }
  }

  return output
}

async function getAiRuntimeConfig() {
  const allSettings = await getAll()

  return {
    provider: String(allSettings.ai_provider?.setting_value || "gemini"),
    model: String(allSettings.ai_model?.setting_value || "").trim(),
    apiKey: String(allSettings.gemini_api_key?.setting_value || ""),
    temperature: Number(allSettings.temperature?.setting_value || 0),
    maxOutputTokens: Number(allSettings.max_output_tokens?.setting_value || 2048),
    baseScore: Number(allSettings.base_score?.setting_value || 100),
  }
}

module.exports = {
  SETTING_DEFINITIONS,
  refreshCache,
  ensureCacheLoaded,
  get,
  getAll,
  set,
  update,
  findByKey,
  getAdminSettingsView,
  getAiRuntimeConfig,
}
