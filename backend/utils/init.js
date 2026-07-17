const fs = require("fs")
const path = require("path")
const { pool } = require("../config/database")
const { get, run } = require("./dbp")
const { hashPin, isHashedPin } = require("./pinSecurity")

const DEFAULT_SYSTEM_SETTINGS = [
  {
    key: "gemini_api_key",
    value: "",
    description: "API Key dùng để gọi Google Gemini",
  },
  {
    key: "ai_provider",
    value: "gemini",
    description: "Nhà cung cấp AI mặc định của hệ thống",
  },
  {
    key: "ai_model",
    value: "",
    description: "Model AI mặc định cho AI Assistant",
  },
  {
    key: "temperature",
    value: "0",
    description: "Temperature mặc định cho AI Assistant",
  },
  {
    key: "max_output_tokens",
    value: "2048",
    description: "Giới hạn số token đầu ra của AI Assistant",
  },
  {
    key: "base_score",
    value: "100",
    description: "Điểm gốc mặc định của mỗi lớp khi bắt đầu tuần thi đua",
  },
]

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
    await pool.query(
      `UPDATE accounts SET pin_bcs = $1 WHERE class_id = $2`,
      [hashed, row.class_id],
    )
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

module.exports = initDb
