const fs = require("fs")
const path = require("path")
const { pool } = require("../config/database")
const { get, run } = require("./dbp")

async function initDb() {
  const schemaPath = path.join(__dirname, "..", "sql", "schema.postgresql.sql")
  const schemaSql = fs.readFileSync(schemaPath, "utf8")

  await pool.query(schemaSql)

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
}

module.exports = initDb
