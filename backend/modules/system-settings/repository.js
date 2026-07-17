const { all, get, run } = require("../../utils/dbp")

async function getAll() {
  return all(
    `
      SELECT id, setting_key, setting_value, description, updated_at, updated_by
      FROM system_settings
      ORDER BY setting_key ASC
    `,
    [],
  )
}

async function findByKey(settingKey) {
  return get(
    `
      SELECT id, setting_key, setting_value, description, updated_at, updated_by
      FROM system_settings
      WHERE setting_key = ?
      LIMIT 1
    `,
    [settingKey],
  )
}

async function upsert({ settingKey, settingValue, description, updatedAt, updatedBy }) {
  return run(
    `
      INSERT INTO system_settings (setting_key, setting_value, description, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (setting_key) DO UPDATE
      SET setting_value = EXCLUDED.setting_value,
          description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
    `,
    [settingKey, settingValue, description, updatedAt, updatedBy],
  )
}

module.exports = {
  getAll,
  findByKey,
  upsert,
}
