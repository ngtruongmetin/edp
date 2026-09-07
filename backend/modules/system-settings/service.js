const repository = require("./repository")

const SETTING_DEFINITIONS = {
  base_score: {
    key: "base_score",
    description: "Điểm gốc mặc định của mỗi lớp khi bắt đầu tuần thi đua",
  },
  school_year: {
    key: "school_year",
    description: "Năm học đang dùng cho cấu trúc học kỳ, tháng và tuần",
  },
  use_electronic_gradebook: {
    key: "use_electronic_gradebook",
    description: "Áp dụng sổ đầu bài điện tử khi tổng kết tuần",
  },
  weekly_bonus_enabled: {
    key: "weekly_bonus_enabled",
    description: "Áp dụng thưởng từ sổ đầu bài theo tuần",
  },
  weekly_bonus_score_threshold: {
    key: "weekly_bonus_score_threshold",
    description: "Điểm sổ đầu bài tối thiểu để xét thưởng tuần",
  },
  weekly_bonus_require_all_entries: {
    key: "weekly_bonus_require_all_entries",
    description: "Yêu cầu tất cả điểm sổ đầu bài đạt ngưỡng để thưởng tuần",
  },
  weekly_bonus_points: {
    key: "weekly_bonus_points",
    description: "Số điểm thưởng sổ đầu bài theo tuần",
  },
  offline_duty_enabled: {
    key: "offline_duty_enabled",
    description: "Cho phép Cờ đỏ sử dụng chế độ đi trực ngoại tuyến",
  },
  limited_edit_categories: {
    key: "limited_edit_categories",
    description: "Các category mà Cờ đỏ được CRUD khi tuần ở trạng thái chỉnh sửa giới hạn",
  },
  diary_schedule_binding_enabled: {
    key: "diary_schedule_binding_enabled",
    description: "Bám theo thời khóa biểu khi tính điểm Sổ đầu bài điện tử",
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

function isEnabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return ["1", "true", "yes", "co", "có"].includes(String(value).trim().toLowerCase())
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
  isEnabled,
}
