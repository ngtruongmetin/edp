const bcrypt = require("bcrypt")
const path = require("path")
const { execFileSync } = require("child_process")
const { pool } = require("../config/database")
const initDb = require("../utils/init")

const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, "..", "edp.db")
const adminUsername = process.env.SEED_ADMIN_USERNAME || "admin"
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123"

const tablesInOrder = [
  "classes",
  "rules",
  "admins",
  "schedule_weeks",
  "accounts",
  "schedule_assignments",
  "duty_sessions",
  "duty_violations",
  "duty_signatures",
  "duty_revision_logs",
  "week_closings",
  "daily_bonus",
  "bonus_uploads",
  "timetables",
  "timetable_entries",
  "weekly_scores",
  "weekly_bonus",
  "month_summaries",
  "month_adjustments",
  "month_scores",
  "semester_summaries",
  "semester_adjustments",
  "semester_scores",
  "year_summaries",
  "year_adjustments",
  "year_scores",
]

const tablesWithId = new Set([
  "classes",
  "rules",
  "admins",
  "schedule_weeks",
  "accounts",
  "schedule_assignments",
  "duty_sessions",
  "duty_violations",
  "duty_signatures",
  "duty_revision_logs",
  "daily_bonus",
  "bonus_uploads",
  "timetables",
  "timetable_entries",
  "weekly_scores",
])

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function runSqliteJson(sql) {
  const output = execFileSync("sqlite3", ["-json", sqlitePath, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
  }).trim()

  if (!output) {
    return []
  }

  return JSON.parse(output)
}

function getSqliteColumns(table) {
  const rows = runSqliteJson(`PRAGMA table_info(${quoteIdent(table)});`)
  return rows.map((row) => row.name)
}

function getSqliteRows(table, columns) {
  const selectList = columns.map(quoteIdent).join(", ")
  return runSqliteJson(`SELECT ${selectList} FROM ${quoteIdent(table)};`)
}

async function getPostgresColumns(client, table) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table],
  )

  return result.rows.map((row) => row.column_name)
}

async function insertBatch(client, table, columns, rows) {
  if (!rows.length || !columns.length) {
    return
  }

  const values = []
  const placeholders = rows.map((row, rowIndex) => {
    const tuple = columns.map((column, columnIndex) => {
      values.push(row[column])
      return `$${rowIndex * columns.length + columnIndex + 1}`
    })
    return `(${tuple.join(", ")})`
  })

  await client.query(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES ${placeholders.join(", ")}`,
    values,
  )
}

async function syncSequence(client, table) {
  const quotedTable = `${quoteIdent("public")}.${quoteIdent(table)}`
  await client.query(
    `
      SELECT setval(
        pg_get_serial_sequence($1, 'id'),
        COALESCE((SELECT MAX(id) FROM ${quotedTable}), 1),
        COALESCE((SELECT COUNT(*) > 0 FROM ${quotedTable}), false)
      )
    `,
    [`public.${table}`],
  )
}

async function upsertAdmin(client) {
  const hash = await bcrypt.hash(adminPassword, 10)
  await client.query(
    `
      INSERT INTO admins (username, password)
      VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE
      SET password = EXCLUDED.password
    `,
    [adminUsername, hash],
  )
}

async function verifyCounts(client, sourceCounts) {
  const mismatches = []
  for (const [table, sourceCount] of Object.entries(sourceCounts)) {
    const result = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`)
    const targetCount = Number(result.rows[0]?.c || 0)
    if (targetCount !== sourceCount) {
      mismatches.push({ table, sourceCount, targetCount })
    }
  }
  return mismatches
}

async function main() {
  await initDb()

  const client = await pool.connect()
  try {
    const sourceCounts = {}
    const tableData = []

    for (const table of tablesInOrder) {
      const sqliteColumns = getSqliteColumns(table)
      const postgresColumns = await getPostgresColumns(client, table)
      const columns = sqliteColumns.filter((column) => postgresColumns.includes(column))
      const rows = getSqliteRows(table, columns)
      sourceCounts[table] = rows.length
      tableData.push({ table, columns, rows })
    }

    await client.query("BEGIN")
    await client.query(`TRUNCATE TABLE ${tablesInOrder.map((table) => quoteIdent(table)).join(", ")} RESTART IDENTITY CASCADE`)

    for (const { table, columns, rows } of tableData) {
      const batchSize = 200
      for (let index = 0; index < rows.length; index += batchSize) {
        await insertBatch(client, table, columns, rows.slice(index, index + batchSize))
      }
      console.log(`Imported ${rows.length} rows into ${table}`)
    }

    await upsertAdmin(client)

    for (const table of tablesInOrder) {
      if (tablesWithId.has(table)) {
        await syncSequence(client, table)
      }
    }

    const mismatches = await verifyCounts(client, sourceCounts)
    if (mismatches.length) {
      throw new Error(`Count mismatches: ${JSON.stringify(mismatches)}`)
    }

    await client.query("COMMIT")
    console.log(`SQLite import complete from ${sqlitePath}`)
    console.log(`Admin ensured: ${adminUsername}`)
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("Import failed:", err.message)
  process.exit(1)
})
