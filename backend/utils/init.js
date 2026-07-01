const db = require("../db")

function initDb() {
  db.serialize(() => {
    // Core tables (so a fresh ./edp.db can boot without manual pre-seeding).
    db.run(`
      CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE,
        grade INTEGER,
        is_active INTEGER DEFAULT 1
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY,
        category TEXT,
        name TEXT,
        score_delta INTEGER
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_weeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_number INTEGER,
        start_date TEXT,
        end_date TEXT,
        created_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        class_id INTEGER UNIQUE,
        password_gvcn TEXT,
        password_bcs TEXT,
        password_codo TEXT,
        pin_bcs TEXT,
        password_changed INTEGER DEFAULT 0,
        password_changed_gvcn INTEGER DEFAULT 0,
        password_changed_bcs INTEGER DEFAULT 0,
        password_changed_codo INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `)

    // Lightweight migrations (existing DBs): add per-role password flags.
    db.run(`ALTER TABLE accounts ADD COLUMN password_changed_gvcn INTEGER DEFAULT 0`, () => {})
    db.run(`ALTER TABLE accounts ADD COLUMN password_changed_bcs INTEGER DEFAULT 0`, () => {})
    db.run(`ALTER TABLE accounts ADD COLUMN password_changed_codo INTEGER DEFAULT 0`, () => {})

    // Backfill for existing rows (keep old behavior if password_changed was already set).
    db.run(
      `UPDATE accounts SET password_changed_gvcn=COALESCE(password_changed_gvcn, password_changed, 0)`,
      () => {},
    )
    db.run(
      `UPDATE accounts SET password_changed_bcs=COALESCE(password_changed_bcs, password_changed, 0)`,
      () => {},
    )
    db.run(
      `UPDATE accounts SET password_changed_codo=COALESCE(password_changed_codo, password_changed, 0)`,
      () => {},
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        red_class TEXT NOT NULL,
        duty_class TEXT NOT NULL,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (red_class) REFERENCES classes(name) ON DELETE CASCADE,
        FOREIGN KEY (duty_class) REFERENCES classes(name) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS duty_sessions (
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
    `)

    // One duty session per (week, date, red_class). Prevents duplicates under concurrent traffic / multi-process.
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_duty_sessions_week_date_red ON duty_sessions(week_id, date, red_class)`,
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS duty_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        rule_id INTEGER NOT NULL,
        quantity INTEGER,
        note TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE RESTRICT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS duty_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        photo_path TEXT,
        signed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS duty_revision_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        action TEXT,
        created_at TEXT,
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS week_closings (
        week_id INTEGER PRIMARY KEY,
        closed_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_bonus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        week_id INTEGER,
        date TEXT,
        class_name TEXT,
        points REAL,
        min_score REAL,
        all_above_9 INTEGER,
        source TEXT,
        periods_json TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE (week_id, date, class_name),
        FOREIGN KEY (session_id) REFERENCES duty_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `)

    // Lightweight migrations for existing DBs.
    db.run(`ALTER TABLE daily_bonus ADD COLUMN min_score REAL`, () => {})
    db.run(`ALTER TABLE daily_bonus ADD COLUMN all_above_9 INTEGER`, () => {})
    db.run(`ALTER TABLE daily_bonus ADD COLUMN id INTEGER`, () => {})
    db.run(`ALTER TABLE daily_bonus ADD COLUMN session_id INTEGER`, () => {})
    db.run(`ALTER TABLE daily_bonus ADD COLUMN periods_json TEXT`, () => {})
    db.run(`ALTER TABLE semester_summaries ADD COLUMN month_keys TEXT`, () => {})
    db.run(`ALTER TABLE year_summaries ADD COLUMN semester_keys TEXT`, () => {})

    // Seed current school year if empty (non-destructive)
    db.get(`SELECT COUNT(*) as c FROM year_summaries`, (err, row) => {
      if (err) return
      const count = Number(row?.c || 0)
      if (count === 0) {
        const now = new Date().toISOString()
        db.run(
          `
            INSERT INTO year_summaries (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
          `,
          ["2025-2026", "[]", "[]", null, now, now],
        )
      }
    })

    db.run(`
      CREATE TABLE IF NOT EXISTS bonus_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER,
        grade TEXT,
        file_name TEXT,
        xlsx_count INTEGER,
        uploaded_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE
      )
    `)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_bonus_uploads_week_grade ON bonus_uploads(week_id, grade)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS timetables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        effective_date TEXT,
        file_name TEXT,
        created_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS timetable_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timetable_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        session TEXT NOT NULL,
        period INTEGER NOT NULL,
        subject TEXT,
        FOREIGN KEY (timetable_id) REFERENCES timetables(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `)

    db.run(
      `CREATE INDEX IF NOT EXISTS idx_timetable_entries ON timetable_entries(timetable_id, class_name, day_of_week, session, period)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS weekly_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        score INTEGER,
        updated_at TEXT,
        FOREIGN KEY (week_id) REFERENCES schedule_weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (class_name) REFERENCES classes(name) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS weekly_bonus (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS month_summaries (
        month_key TEXT PRIMARY KEY,
        week_ids TEXT,
        closed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS month_adjustments (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS month_scores (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS semester_summaries (
        semester_key TEXT PRIMARY KEY,
        week_ids TEXT,
        month_keys TEXT,
        closed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS semester_adjustments (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS semester_scores (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS year_summaries (
        year_key TEXT PRIMARY KEY,
        week_ids TEXT,
        semester_keys TEXT,
        closed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS year_adjustments (
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
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS year_scores (
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
    `)

    // Helpful indexes (safe to add; no behavior change).
    db.run(`CREATE INDEX IF NOT EXISTS idx_schedule_assignments_week ON schedule_assignments(week_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_sessions_week_date ON duty_sessions(week_id, date)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_sessions_red ON duty_sessions(red_class)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_sessions_duty ON duty_sessions(duty_class)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_violations_session ON duty_violations(session_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_violations_rule ON duty_violations(rule_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_signatures_session ON duty_signatures(session_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_duty_revision_logs_session ON duty_revision_logs(session_id)`)
  })
}

module.exports = initDb
