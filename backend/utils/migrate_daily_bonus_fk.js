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

    // Recreate daily_bonus table with session_id FK
    await exec(
      db,
      `
      CREATE TABLE daily_bonus_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        week_id INTEGER,
        date TEXT,
        class_name TEXT,
        points REAL,
        min_score REAL,
        all_above_9 INTEGER,
        source TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE (week_id, date, class_name),
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )

    // Copy existing data, setting session_id = NULL initially
    await exec(
      db,
      `
      INSERT INTO daily_bonus_new(session_id,week_id,date,class_name,points,min_score,all_above_9,source,created_at,updated_at)
      SELECT NULL,week_id,date,class_name,points,min_score,all_above_9,source,created_at,updated_at
      FROM daily_bonus
    `,
    )

    // Drop the old table
    await exec(db, "DROP TABLE daily_bonus")

    // Rename the new table
    await exec(db, "ALTER TABLE daily_bonus_new RENAME TO daily_bonus")

    // Create index for performance
    await exec(db, "CREATE INDEX IF NOT EXISTS idx_daily_bonus_session ON daily_bonus(session_id)")

    await exec(db, "COMMIT")
    await exec(db, "PRAGMA foreign_keys = ON")

    console.log("✅ Migration completed successfully!")
    console.log("✅ daily_bonus table now has session_id FK to duty_sessions")
    console.log("✅ Deleting a duty_session will now automatically delete its bonus points")

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
