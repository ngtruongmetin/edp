const db = require("../db")
const time = require("./time")

function isSunday(dateStr) {
  const dt = new Date(String(dateStr) + "T00:00:00")
  return dt.getDay() === 0
}

function getWeekForDate(date, cb) {
  db.get(
    `
      SELECT *
      FROM schedule_weeks
      WHERE start_date <= ?
        AND end_date >= ?
      ORDER BY week_number DESC
      LIMIT 1
    `,
    [date, date],
    cb,
  )
}

function ensureDailySessionsForDate({ weekId, date }, cb) {
  if (!weekId || !date) return cb(null, { created: 0 })

  const now = time.now()
  db.serialize(() => {
    db.run("BEGIN IMMEDIATE", (err) => {
      if (err) return cb(err)
      db.run(
        `
          INSERT OR IGNORE INTO duty_sessions(week_id,date,red_class,duty_class,status,created_at)
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

function backfillDates(dates) {
  const queue = [...dates]
  function next() {
    const date = queue.shift()
    if (!date) {
      console.log("[dutyBackfill] done")
      db.close()
      return
    }

    if (isSunday(date)) {
      console.log(`[dutyBackfill] skip Sunday ${date}`)
      return next()
    }

    getWeekForDate(date, (err, week) => {
      if (err) {
        console.error("[dutyBackfill] getWeekForDate error:", err.message)
        return next()
      }
      if (!week) {
        console.log(`[dutyBackfill] no week for ${date}`)
        return next()
      }

      ensureDailySessionsForDate({ weekId: week.id, date }, (err2, out) => {
        if (err2) {
          console.error("[dutyBackfill] ensureDailySessionsForDate error:", err2.message)
        } else {
          console.log(`[dutyBackfill] ${date} (week_id=${week.id}): created ${out?.created || 0}`)
        }
        next()
      })
    })
  }
  next()
}

const args = process.argv.slice(2)
if (!args.length) {
  console.log("Usage: node backend/utils/dutyBackfill.js YYYY-MM-DD [YYYY-MM-DD ...]")
  process.exit(0)
}

backfillDates(args)
