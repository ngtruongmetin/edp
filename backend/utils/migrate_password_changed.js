/* eslint-disable no-console */
const db = require("../db")
const { run } = require("./dbp")

async function main() {
  await run("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed INTEGER DEFAULT 0")
  console.log("Migration completed: ensured accounts.password_changed")
  await db.close()
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message)
  await db.close().catch(() => {})
  process.exit(1)
})
