const bcrypt = require("bcrypt")
const db = require("../db")
const initDb = require("../utils/init")
const { run } = require("../utils/dbp")

const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin"
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin123"

async function main() {
  await initDb()

  const hash = await bcrypt.hash(PASSWORD, 10)

  await run(
    `
      INSERT INTO admins (username, password)
      VALUES (?, ?)
      ON CONFLICT (username) DO UPDATE
      SET password = EXCLUDED.password
    `,
    [USERNAME, hash],
  )

  console.log(`Seeded admin account: ${USERNAME}`)
  await db.close()
}

main().catch(async (err) => {
  console.error("Seed admin failed:", err.message)
  await db.close().catch(() => {})
  process.exit(1)
})
