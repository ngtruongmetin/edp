const { get } = require("../../utils/dbp")

async function findCurrent() {
  return get(
    `
      SELECT id, provider, api_key, base_url, model, temperature, updated_at, updated_by
      FROM ai_settings
      ORDER BY id ASC
      LIMIT 1
    `,
    [],
  )
}

async function upsert({
  provider,
  apiKey,
  baseUrl,
  model,
  temperature,
  updatedAt,
  updatedBy,
}) {
  return get(
    `
      INSERT INTO ai_settings (id, provider, api_key, base_url, model, temperature, updated_at, updated_by)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE
      SET provider = EXCLUDED.provider,
          api_key = EXCLUDED.api_key,
          base_url = EXCLUDED.base_url,
          model = EXCLUDED.model,
          temperature = EXCLUDED.temperature,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
      RETURNING id, provider, api_key, base_url, model, temperature, updated_at, updated_by
    `,
    [provider, apiKey, baseUrl, model, temperature, updatedAt, updatedBy],
  )
}

module.exports = {
  findCurrent,
  upsert,
}
