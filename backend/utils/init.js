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
  {
    key: "school_year",
    value: "2026-2027",
    description: "Năm học đang dùng cho cấu trúc học kỳ, tháng và tuần",
  },
  {
    key: "use_electronic_gradebook",
    value: "1",
    description: "Ap dung so dau bai dien tu khi tong ket tuan",
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

async function ensureDefaultTimeHierarchy(now) {
  await pool.query(`
    UPDATE months
    SET month_key = $1
    WHERE month_key = $2
      AND NOT EXISTS (
        SELECT 1
        FROM months existing
        WHERE existing.month_key = $1
      )
  `, ["09/2026", "2026-09"])

  await pool.query(`
    UPDATE month_summaries
    SET month_key = $1
    WHERE month_key = $2
      AND NOT EXISTS (
        SELECT 1
        FROM month_summaries existing
        WHERE existing.month_key = $1
      )
  `, ["09/2026", "2026-09"])

  await pool.query(`
    UPDATE month_adjustments ma
    SET month_key = $1
    WHERE month_key = $2
      AND NOT EXISTS (
        SELECT 1
        FROM month_adjustments existing
        WHERE existing.month_key = $1
          AND existing.class_name = ma.class_name
      )
  `, ["09/2026", "2026-09"])

  await pool.query(`
    UPDATE month_scores ms
    SET month_key = $1
    WHERE month_key = $2
      AND NOT EXISTS (
        SELECT 1
        FROM month_scores existing
        WHERE existing.month_key = $1
          AND existing.class_name = ms.class_name
      )
  `, ["09/2026", "2026-09"])

  await pool.query(`
    UPDATE semester_summaries
    SET month_keys = REPLACE(month_keys, '"2026-09"', '"09/2026"')
    WHERE month_keys LIKE '%"2026-09"%'
  `)

  const schoolYear = await pool.query(
    `
      INSERT INTO school_years (name, start_year, end_year, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (name) DO UPDATE
      SET start_year = EXCLUDED.start_year,
          end_year = EXCLUDED.end_year
      RETURNING id
    `,
    ["2026-2027", 2026, 2027, now],
  )
  const schoolYearId = schoolYear.rows[0].id

  const semester = await pool.query(
    `
      INSERT INTO semesters (school_year_id, semester_number, name, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (school_year_id, semester_number) DO UPDATE
      SET name = EXCLUDED.name
      RETURNING id
    `,
    [schoolYearId, 1, "Học kỳ I", now],
  )
  const semesterId = semester.rows[0].id

  await pool.query(
    `
      INSERT INTO months (semester_id, month_number, month_key, name, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (month_key) DO UPDATE
      SET semester_id = EXCLUDED.semester_id,
          month_number = EXCLUDED.month_number,
          name = EXCLUDED.name
      RETURNING id
    `,
    [semesterId, 9, "09/2026", "Tháng 9", now],
  )
  await pool.query(`
    ALTER TABLE schedule_weeks
    ALTER COLUMN month_id SET NOT NULL
  `)
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

  const now = new Date().toISOString()
  await ensureDefaultTimeHierarchy(now)

  const row = await get(`SELECT COUNT(*)::int as c FROM year_summaries`)
  const count = Number(row?.c || 0)
  if (count === 0) {
    await run(
      `
        INSERT INTO year_summaries (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
        VALUES(?,?,?,?,?,?)
      `,
      ["2026-2027", "[]", "[]", null, now, now],
    )
  }

  await seedSystemSettings(now)
  await seedAiSettings(now)
}

module.exports = initDb
