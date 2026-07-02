/* eslint-disable no-console */
const db = require("../db")
const { run } = require("./dbp")

async function main() {
  await run("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_gvcn INTEGER DEFAULT 0")
  await run("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_bcs INTEGER DEFAULT 0")
  await run("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_codo INTEGER DEFAULT 0")
  await run(
    `UPDATE accounts
     SET password_changed_gvcn = COALESCE(password_changed_gvcn, password_changed, 0),
         password_changed_bcs = COALESCE(password_changed_bcs, password_changed, 0),
         password_changed_codo = COALESCE(password_changed_codo, password_changed, 0)`,
  )

  console.log("Migration completed: ensured per-role password flags")
  await db.close()
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message)
  await db.close().catch(() => {})
  process.exit(1)
})
