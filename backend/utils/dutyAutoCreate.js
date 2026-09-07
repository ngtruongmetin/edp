const db = require("../db")
const time = require("./time")
const { syncAllWeekStatuses } = require("./weekState")

function isSunday(dateStr) {
  const dt = new Date(String(dateStr) + "T00:00:00")
  return dt.getDay() === 0
}

function getWeekForDate(date, cb) {
  db.get(
    `
      SELECT *
      FROM schedule_weeks
      WHERE COALESCE(start_datetime, start_date || ' 00:00:00') <= ?
        AND COALESCE(end_datetime, end_date || ' 23:59:59') >= ?
      ORDER BY week_number DESC
      LIMIT 1
    `,
    [`${date} 23:59:59`, `${date} 23:59:59`],
    cb,
  )
}

function isWeekClosed(weekId, cb) {
  db.get(
    `SELECT week_id, closed_at FROM week_closings WHERE week_id=? LIMIT 1`,
    [weekId],
    (err, row) => {
      if (err) return cb(err)
      cb(null, !!row, row?.closed_at || null)
    },
  )
}

function ensureDailySessionsForDate({ weekId, date }, cb) {
  if (!weekId || !date) return cb(null, { created: 0 })

  const now = time.now()
  db.serialize(() => {
    db.run("BEGIN", (err) => {
      if (err) return cb(err)
      db.run(
        `
          INSERT INTO duty_sessions(week_id,date,red_class,duty_class,status,created_at)
          SELECT
            ? as week_id,
            ? as date,
            a.red_class,
            a.duty_class,
            'draft' as status,
            ? as created_at
          FROM schedule_assignments a
          WHERE a.week_id=?
            AND NOT EXISTS (
              SELECT 1
              FROM duty_sessions s
              WHERE s.week_id=?
                AND s.date=?
                AND s.red_class=a.red_class
            )
          ON CONFLICT (week_id, date, red_class) DO NOTHING
        `,
        [weekId, date, now, weekId, weekId, date],
        function (err2) {
          if (err2) {
            db.run("ROLLBACK", () => cb(err2))
            return
          }
          const created = this.changes || 0
          db.run("COMMIT", (err3) => {
            if (err3) return cb(err3)
            cb(null, { created })
          })
        },
      )
    })
  })
}

function msUntilNextMidnightLocal() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(0, next.getTime() - now.getTime())
}

function runMidnightJob() {
  const today = time.today()
  if (isSunday(today)) return

  getWeekForDate(today, (err, week) => {
    if (err) return console.error("[dutyAutoCreate] getWeekForDate error:", err.message)
    if (!week) return

    isWeekClosed(week.id, (err2, closed) => {
      if (err2) return console.error("[dutyAutoCreate] isWeekClosed error:", err2.message)
      if (closed) return

      ensureDailySessionsForDate({ weekId: week.id, date: today }, (err3, out) => {
        if (err3) return console.error("[dutyAutoCreate] ensureDailySessionsForDate error:", err3.message)
        const created = out?.created || 0
        if (created > 0) {
          console.log(`[dutyAutoCreate] ${today}: created ${created} duty_sessions`)
        }
      })
    })
  })
}

function startDutyAutoCreateScheduler({ repairOnStart = true } = {}) {
  // Repair in case server was down at 00:00. This is idempotent and only fills missing rows.
  if (repairOnStart) {
    try {
      runMidnightJob()
    } catch (e) {
      console.error("[dutyAutoCreate] repairOnStart error:", e?.message || e)
    }
  }

  const delay = msUntilNextMidnightLocal()
  setTimeout(() => {
    runMidnightJob()
    setInterval(runMidnightJob, 24 * 60 * 60 * 1000)
  }, delay)

  // Persist the limited-edit transition close to each configured end time.
  setInterval(() => {
    syncAllWeekStatuses((error) => {
      if (error) console.error("[dutyAutoCreate] sync week statuses error:", error.message)
    })
  }, 60 * 1000)

  console.log(`[dutyAutoCreate] scheduler armed (next run in ${Math.round(delay / 1000)}s)`)
}

module.exports = { startDutyAutoCreateScheduler }
