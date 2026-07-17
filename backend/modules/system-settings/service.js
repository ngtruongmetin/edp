const repository = require("./repository")

const SETTING_DEFINITIONS = {
  base_score: {
    key: "base_score",
    description: "Điểm gốc mặc định của mỗi lớp khi bắt đầu tuần thi đua",
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

  for (const [settingKey, definition] of Object.entries(SETTING_DEFINITIONS)) {
    const record = allSettings[settingKey]
    output[settingKey] = {
      key: settingKey,
      description: definition.description,
      value: record?.setting_value || "",
      updated_at: record?.updated_at || null,
      updated_by: record?.updated_by || null,
    }
  }

  return output
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
}
