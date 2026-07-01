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
    await exec(db, "PRAGMA foreign_keys = OFF")
    await exec(db, "BEGIN")

    // Cleanup: remove rows that would violate the new FK constraints.
    // We keep a strict policy: if a parent is missing, we delete the orphan row.
    const cleanupStatements = [
      // schedule_assignments -> schedule_weeks / classes(name)
      `DELETE FROM schedule_assignments WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM schedule_assignments WHERE red_class NOT IN (SELECT name FROM classes)`,
      `DELETE FROM schedule_assignments WHERE duty_class NOT IN (SELECT name FROM classes)`,

      // duty_sessions -> schedule_weeks / classes(name)
      `DELETE FROM duty_sessions WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM duty_sessions WHERE red_class NOT IN (SELECT name FROM classes)`,
      `DELETE FROM duty_sessions WHERE duty_class NOT IN (SELECT name FROM classes)`,

      // duty_violations -> duty_sessions / rules
      `DELETE FROM duty_violations WHERE session_id NOT IN (SELECT id FROM duty_sessions)`,
      `DELETE FROM duty_violations WHERE rule_id NOT IN (SELECT id FROM rules)`,

      // signatures/logs -> duty_sessions
      `DELETE FROM duty_signatures WHERE session_id NOT IN (SELECT id FROM duty_sessions)`,
      `DELETE FROM duty_revision_logs WHERE session_id NOT IN (SELECT id FROM duty_sessions)`,

      // closing/scores/bonus -> weeks/classes
      `DELETE FROM week_closings WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM weekly_scores WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM weekly_scores WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM daily_bonus WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM daily_bonus WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM weekly_bonus WHERE week_id NOT IN (SELECT id FROM schedule_weeks)`,
      `DELETE FROM weekly_bonus WHERE class_name NOT IN (SELECT name FROM classes)`,

      // accounts -> classes
      `DELETE FROM accounts WHERE class_id NOT IN (SELECT id FROM classes)`,

      // period adjustments/scores -> classes
      `DELETE FROM month_adjustments WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM month_scores WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM semester_adjustments WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM semester_scores WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM year_adjustments WHERE class_name NOT IN (SELECT name FROM classes)`,
      `DELETE FROM year_scores WHERE class_name NOT IN (SELECT name FROM classes)`,
    ]

    for (const st of cleanupStatements) await exec(db, st)

    // Rebuild tables with FK constraints.
    // Note: SQLite requires table rebuild to add foreign keys.

    // accounts
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
        created_at TEXT,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `,
    )
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

    // schedule_assignments
    await exec(
      db,
      `
      CREATE TABLE schedule_assignments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        red_class TEXT NOT NULL,
        duty_class TEXT NOT NULL,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (red_class) REFERENCES classes(name) ON DELETE CASCADE,
        FOREIGN KEY (duty_class) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO schedule_assignments_new(id,week_id,red_class,duty_class)
      SELECT id,week_id,red_class,duty_class
      FROM schedule_assignments
    `,
    )
    await exec(db, "DROP TABLE schedule_assignments")
    await exec(db, "ALTER TABLE schedule_assignments_new RENAME TO schedule_assignments")

    // duty_sessions
    await exec(
      db,
      `
      CREATE TABLE duty_sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        date TEXT,
        red_class TEXT NOT NULL,
        duty_class TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft','signed')),
        created_at TEXT,
        signed_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (red_class) REFERENCES classes(name) ON DELETE CASCADE,
        FOREIGN KEY (duty_class) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO duty_sessions_new(id,week_id,date,red_class,duty_class,status,created_at,signed_at)
      SELECT id,week_id,date,red_class,duty_class,status,created_at,signed_at
      FROM duty_sessions
    `,
    )
    await exec(db, "DROP TABLE duty_sessions")
    await exec(db, "ALTER TABLE duty_sessions_new RENAME TO duty_sessions")

    // duty_violations
    await exec(
      db,
      `
      CREATE TABLE duty_violations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        rule_id INTEGER NOT NULL,
        quantity INTEGER,
        note TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE RESTRICT
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO duty_violations_new(id,session_id,rule_id,quantity,note)
      SELECT id,session_id,rule_id,quantity,note
      FROM duty_violations
    `,
    )
    await exec(db, "DROP TABLE duty_violations")
    await exec(db, "ALTER TABLE duty_violations_new RENAME TO duty_violations")

    // duty_signatures
    await exec(
      db,
      `
      CREATE TABLE duty_signatures_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        photo_path TEXT,
        signed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO duty_signatures_new(id,session_id,photo_path,signed_at)
      SELECT id,session_id,photo_path,signed_at
      FROM duty_signatures
    `,
    )
    await exec(db, "DROP TABLE duty_signatures")
    await exec(db, "ALTER TABLE duty_signatures_new RENAME TO duty_signatures")

    // duty_revision_logs
    await exec(
      db,
      `
      CREATE TABLE duty_revision_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        action TEXT,
        created_at TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO duty_revision_logs_new(id,session_id,action,created_at)
      SELECT id,session_id,action,created_at
      FROM duty_revision_logs
    `,
    )
    await exec(db, "DROP TABLE duty_revision_logs")
    await exec(db, "ALTER TABLE duty_revision_logs_new RENAME TO duty_revision_logs")

    // week_closings
    await exec(
      db,
      `
      CREATE TABLE week_closings_new (
        week_id INTEGER PRIMARY KEY,
        closed_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO week_closings_new(week_id,closed_at)
      SELECT week_id,closed_at FROM week_closings
    `,
    )
    await exec(db, "DROP TABLE week_closings")
    await exec(db, "ALTER TABLE week_closings_new RENAME TO week_closings")

    // weekly_scores
    await exec(
      db,
      `
      CREATE TABLE weekly_scores_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        score INTEGER,
        updated_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO weekly_scores_new(id,week_id,class_name,score,updated_at)
      SELECT id,week_id,class_name,score,updated_at
      FROM weekly_scores
    `,
    )
    await exec(db, "DROP TABLE weekly_scores")
    await exec(db, "ALTER TABLE weekly_scores_new RENAME TO weekly_scores")

    // daily_bonus
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
    await exec(
      db,
      `
      INSERT INTO daily_bonus_new(session_id,week_id,date,class_name,points,min_score,all_above_9,source,created_at,updated_at)
      SELECT NULL,week_id,date,class_name,points,min_score,all_above_9,source,created_at,updated_at
      FROM daily_bonus
    `,
    )
    await exec(db, "DROP TABLE daily_bonus")
    await exec(db, "ALTER TABLE daily_bonus_new RENAME TO daily_bonus")

    // weekly_bonus
    await exec(
      db,
      `
      CREATE TABLE weekly_bonus_new (
        week_id INTEGER,
        class_name TEXT,
        points REAL,
        reason TEXT,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (week_id, class_name),
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO weekly_bonus_new(week_id,class_name,points,reason,created_at,updated_at)
      SELECT week_id,class_name,points,reason,created_at,updated_at
      FROM weekly_bonus
    `,
    )
    await exec(db, "DROP TABLE weekly_bonus")
    await exec(db, "ALTER TABLE weekly_bonus_new RENAME TO weekly_bonus")

    // month_adjustments / month_scores
    await exec(
      db,
      `
      CREATE TABLE month_adjustments_new (
        month_key TEXT,
        class_name TEXT,
        plus_points REAL,
        minus_points REAL,
        reason TEXT,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (month_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO month_adjustments_new(month_key,class_name,plus_points,minus_points,reason,created_at,updated_at)
      SELECT month_key,class_name,plus_points,minus_points,reason,created_at,updated_at
      FROM month_adjustments
    `,
    )
    await exec(db, "DROP TABLE month_adjustments")
    await exec(db, "ALTER TABLE month_adjustments_new RENAME TO month_adjustments")

    await exec(
      db,
      `
      CREATE TABLE month_scores_new (
        month_key TEXT,
        class_name TEXT,
        grade INTEGER,
        plus_points REAL,
        minus_points REAL,
        total_score REAL,
        rank INTEGER,
        note TEXT,
        updated_at TEXT,
        PRIMARY KEY (month_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO month_scores_new(month_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at)
      SELECT month_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at
      FROM month_scores
    `,
    )
    await exec(db, "DROP TABLE month_scores")
    await exec(db, "ALTER TABLE month_scores_new RENAME TO month_scores")

    // semester_adjustments / semester_scores
    await exec(
      db,
      `
      CREATE TABLE semester_adjustments_new (
        semester_key TEXT,
        class_name TEXT,
        plus_points REAL,
        minus_points REAL,
        reason TEXT,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (semester_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO semester_adjustments_new(semester_key,class_name,plus_points,minus_points,reason,created_at,updated_at)
      SELECT semester_key,class_name,plus_points,minus_points,reason,created_at,updated_at
      FROM semester_adjustments
    `,
    )
    await exec(db, "DROP TABLE semester_adjustments")
    await exec(db, "ALTER TABLE semester_adjustments_new RENAME TO semester_adjustments")

    await exec(
      db,
      `
      CREATE TABLE semester_scores_new (
        semester_key TEXT,
        class_name TEXT,
        grade INTEGER,
        plus_points REAL,
        minus_points REAL,
        total_score REAL,
        rank INTEGER,
        note TEXT,
        updated_at TEXT,
        PRIMARY KEY (semester_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO semester_scores_new(semester_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at)
      SELECT semester_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at
      FROM semester_scores
    `,
    )
    await exec(db, "DROP TABLE semester_scores")
    await exec(db, "ALTER TABLE semester_scores_new RENAME TO semester_scores")

    // year_adjustments / year_scores
    await exec(
      db,
      `
      CREATE TABLE year_adjustments_new (
        year_key TEXT,
        class_name TEXT,
        plus_points REAL,
        minus_points REAL,
        reason TEXT,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (year_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO year_adjustments_new(year_key,class_name,plus_points,minus_points,reason,created_at,updated_at)
      SELECT year_key,class_name,plus_points,minus_points,reason,created_at,updated_at
      FROM year_adjustments
    `,
    )
    await exec(db, "DROP TABLE year_adjustments")
    await exec(db, "ALTER TABLE year_adjustments_new RENAME TO year_adjustments")

    await exec(
      db,
      `
      CREATE TABLE year_scores_new (
        year_key TEXT,
        class_name TEXT,
        grade INTEGER,
        plus_points REAL,
        minus_points REAL,
        total_score REAL,
        rank INTEGER,
        note TEXT,
        updated_at TEXT,
        PRIMARY KEY (year_key, class_name),
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `,
    )
    await exec(
      db,
      `
      INSERT INTO year_scores_new(year_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at)
      SELECT year_key,class_name,grade,plus_points,minus_points,total_score,rank,note,updated_at
      FROM year_scores
    `,
    )
    await exec(db, "DROP TABLE year_scores")
    await exec(db, "ALTER TABLE year_scores_new RENAME TO year_scores")

    await exec(db, "COMMIT")
    await exec(db, "PRAGMA foreign_keys = ON")

    const fkIssues = await all(db, "PRAGMA foreign_key_check")
    if (fkIssues.length) {
      console.error("Foreign key violations detected:", fkIssues)
      console.error("You can restore from backup:", backupPath)
      process.exitCode = 2
    } else {
      console.log("Migration OK. Foreign keys are now enforced.")
    }
  } catch (err) {
    console.error("Migration failed:", err?.message || err)
    try {
      await exec(db, "ROLLBACK")
    } catch {}
    console.error("Restore from backup if needed:", backupPath)
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main()

