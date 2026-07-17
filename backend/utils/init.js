const fs = require("fs")
const path = require("path")
const { pool } = require("../config/database")
const { get, run } = require("./dbp")
const { hashPin, isHashedPin } = require("./pinSecurity")

const DEFAULT_SYSTEM_SETTINGS = [
  {
    key: "temperature",
    value: "0",
    description: "Temperature mặc định cho AI Assistant",
  },
  {
    key: "base_score",
    value: "100",
    description: "Điểm gốc mặc định của mỗi lớp khi bắt đầu tuần thi đua",
  },
]

function detectProviderFromApiKey(apiKey) {
  const key = String(apiKey || "").trim()
  if (!key) return "custom"
  if (key.startsWith("gsk_")) return "groq"
  if (key.startsWith("sk-or-v1-")) return "openrouter"
  if (key.startsWith("sk-proj-") || key.startsWith("sk-")) return "openai"
  if (key.startsWith("AIza")) return "gemini"
  return "custom"
}

function getDefaultBaseUrl(provider) {
  const defaults = {
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    custom: "",
  }

  return defaults[String(provider || "").trim().toLowerCase()] || ""
}

async function seedSystemSettings(now) {
  for (const setting of DEFAULT_SYSTEM_SETTINGS) {
    await pool.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description, updated_at, updated_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (setting_key) DO UPDATE
        SET description = EXCLUDED.description
      `,
      [setting.key, setting.value, setting.description, now, "system"],
    )
  }
}

async function seedAiSettings(now) {
  const existingAiSettings = await pool.query(
    `
      SELECT id
      FROM ai_settings
      WHERE id = 1
      LIMIT 1
    `,
  )

  if ((existingAiSettings.rows || []).length > 0) {
    return
  }

  const legacyRows = await pool.query(
    `
      SELECT setting_key, setting_value
      FROM system_settings
      WHERE setting_key IN ('gemini_api_key', 'ai_provider', 'ai_model', 'temperature')
    `,
  )

  const legacyMap = new Map()
  for (const row of legacyRows.rows || []) {
    legacyMap.set(String(row.setting_key || ""), String(row.setting_value || ""))
  }

  const legacyApiKey = String(legacyMap.get("gemini_api_key") || "")
  const detectedProvider = detectProviderFromApiKey(legacyApiKey)
  const legacyProvider = String(legacyMap.get("ai_provider") || "").trim().toLowerCase()
  const provider = legacyProvider || detectedProvider || "custom"
  const baseUrl = getDefaultBaseUrl(provider)
  const model = String(legacyMap.get("ai_model") || "").trim()
  const temperature = Number(legacyMap.get("temperature") || 0)

  await pool.query(
    `
      INSERT INTO ai_settings (id, provider, api_key, base_url, model, temperature, updated_at, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      1,
      provider,
      legacyApiKey,
      baseUrl,
      model,
      Number.isFinite(temperature) ? temperature : 0,
      now,
      "system",
    ],
  )
}

async function initDb() {
  const schemaPath = path.join(__dirname, "..", "sql", "schema.postgresql.sql")
  const schemaSql = fs.readFileSync(schemaPath, "utf8")

  await pool.query(schemaSql)

  await pool.query(`
    ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0
  `)

  await pool.query(`
    ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS pin_locked_until BIGINT NOT NULL DEFAULT 0
  `)

  await pool.query(`
    ALTER TABLE admins
    DROP COLUMN IF EXISTS is_super_admin
  `)

  const pinRows = await pool.query(
    `
      SELECT class_id, pin_bcs
      FROM accounts
      WHERE pin_bcs IS NOT NULL
    `,
  )

  for (const row of pinRows.rows || []) {
    const current = String(row.pin_bcs || "").trim()
    if (!current || isHashedPin(current)) continue
    const hashed = await hashPin(current)
    await pool.query(`UPDATE accounts SET pin_bcs = $1 WHERE class_id = $2`, [hashed, row.class_id])
  }

  await run(
    `UPDATE accounts
     SET password_changed_gvcn = COALESCE(password_changed_gvcn, password_changed, 0),
         password_changed_bcs = COALESCE(password_changed_bcs, password_changed, 0),
         password_changed_codo = COALESCE(password_changed_codo, password_changed, 0)`,
  )

  const row = await get(`SELECT COUNT(*)::int as c FROM year_summaries`)
  const count = Number(row?.c || 0)
  if (count === 0) {
    const now = new Date().toISOString()
    await run(
      `
        INSERT INTO year_summaries (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
        VALUES(?,?,?,?,?,?)
      `,
      ["2025-2026", "[]", "[]", null, now, now],
    )
  }

  const now = new Date().toISOString()
  await seedSystemSettings(now)
  await seedAiSettings(now)
}

module.exports = initDb
