const SystemSettingService = require("../modules/system-settings/service")

const DEFAULT_CATEGORIES = ["Chuyên cần"]

function parseCategories(value) {
  try {
    const parsed = JSON.parse(String(value || ""))
    if (Array.isArray(parsed)) {
      const categories = [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))]
      if (categories.length) return categories
    }
  } catch {
    // Keep the configured behavior usable if an old/malformed value exists.
  }
  return DEFAULT_CATEGORIES
}

async function getLimitedEditCategories() {
  return parseCategories(await SystemSettingService.get("limited_edit_categories", JSON.stringify(DEFAULT_CATEGORIES)))
}

module.exports = { DEFAULT_CATEGORIES, parseCategories, getLimitedEditCategories }
