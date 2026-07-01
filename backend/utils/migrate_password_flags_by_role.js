/* eslint-disable no-console */
const fs = require("fs")
const path = require("path")
const sqlite3 = require("sqlite3").verbose()

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve(this)
    })
  })
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err)
      resolve(rows)
    })
  })
}

async function main() {
  const dbPath = path.join(__dirname, "..", "edp.db")
  if (!fs.existsSync(dbPath)) {
    console.error("DB not found:", dbPath)
    process.exit(1)
  }

  const backupPath = path.join(__dirname, "..", `edp.db.bak_${nowStamp()}`)
  fs.copyFileSync(dbPath, backupPath)
  console.log("Backup created:", backupPath)

  const db = new sqlite3.Database(dbPath)

  try {
    await run(db, "PRAGMA foreign_keys = OFF")
    await run(db, "BEGIN")

    const cols = await all(db, `PRAGMA table_info(accounts)`)
    const names = new Set((cols || []).map((c) => String(c.name)))

    const wanted = [
      { name: "password_changed_gvcn", ddl: "ALTER TABLE accounts ADD COLUMN password_changed_gvcn INTEGER DEFAULT 0" },
      { name: "password_changed_bcs", ddl: "ALTER TABLE accounts ADD COLUMN password_changed_bcs INTEGER DEFAULT 0" },
      { name: "password_changed_codo", ddl: "ALTER TABLE accounts ADD COLUMN password_changed_codo INTEGER DEFAULT 0" },
    ]

    for (const w of wanted) {
      if (!names.has(w.name)) {
        await run(db, w.ddl)
        console.log("Added column:", w.name)
      }
    }

    // Backfill from legacy column password_changed if present.
    if (names.has("password_changed")) {
      await run(
        db,
        `UPDATE accounts
         SET password_changed_gvcn=COALESCE(password_changed_gvcn, password_changed, 0),
             password_changed_bcs=COALESCE(password_changed_bcs, password_changed, 0),
             password_changed_codo=COALESCE(password_changed_codo, password_changed, 0)
        `,
      )
      console.log("Backfilled role flags from password_changed")
    }

    await run(db, "COMMIT")
    await run(db, "PRAGMA foreign_keys = ON")

    console.log("✅ Migration completed successfully!")
  } catch (err) {
    console.error("❌ Migration failed:", err.message)
    try {
      await run(db, "ROLLBACK")
    } catch {
      // ignore
    }
    process.exit(1)
  } finally {
    db.close()
  }
}

main()

