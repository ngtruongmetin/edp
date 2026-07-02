/* eslint-disable no-console */
const db = require("../db")
const initDb = require("./init")

async function main() {
  await initDb()
  console.log("Migration completed: ensured daily_bonus foreign keys and indexes")
  await db.close()
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message)
  await db.close().catch(() => {})
  process.exit(1)
})
