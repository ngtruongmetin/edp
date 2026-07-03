/* eslint-disable no-console */
const db = require("../db")
const initDb = require("./init")

async function main() {
  await initDb()
  console.log("Migration completed: ensured PostgreSQL schema and foreign keys")
  await db.close()
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message)
  await db.close().catch(() => {})
  process.exit(1)
})
