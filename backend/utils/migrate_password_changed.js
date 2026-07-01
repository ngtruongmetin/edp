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

function exec(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve(this)
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
    await exec(db, "PRAGMA foreign_keys = OFF")
    await exec(db, "BEGIN")

    // Add password_changed column to accounts table
    await exec(
      db,
      `
      CREATE TABLE accounts_new (
        id INTEGER PRIMARY KEY,
        class_id INTEGER UNIQUE,
        password_gvcn TEXT,
        password_bcs TEXT,
        password_codo TEXT,
        pin_bcs TEXT,
        password_changed INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `,
    )

    // Copy existing data
    await exec(
      db,
      `
      INSERT INTO accounts_new(id,class_id,password_gvcn,password_bcs,password_codo,pin_bcs,created_at)
      SELECT id,class_id,password_gvcn,password_bcs,password_codo,pin_bcs,created_at
      FROM accounts
    `,
    )

    await exec(db, "DROP TABLE accounts")
    await exec(db, "ALTER TABLE accounts_new RENAME TO accounts")

    await exec(db, "COMMIT")
    await exec(db, "PRAGMA foreign_keys = ON")

    console.log("✅ Migration completed successfully!")
    console.log("✅ Added password_changed column to accounts table")

  } catch (err) {
    console.error("❌ Migration failed:", err.message)
    try {
      await exec(db, "ROLLBACK")
    } catch (e) {
      // rollback error
    }
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
