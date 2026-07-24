const express = require("express")
const db = require("../../db")
const bcrypt = require("bcrypt")
const fs = require("fs")
const path = require("path")
const xlsx = require("xlsx")
const ExcelJS = require("exceljs")
const crypto = require("crypto")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const SystemSettingService = require("../system-settings/service")

const time = require("../../utils/time")

const router = express.Router()

/*
PUBLIC: landing stats (no auth)
*/
router.get("/public/landing-stats", (req, res) => {
  db.get(`SELECT COUNT(*) as total FROM duty_sessions`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ duty_sessions: Number(row?.total || 0) })
  })
})

/*
PUBLIC: landing competition summary (no auth)
*/
router.get("/public/landing-competition", (req, res) => {
  db.get(
    `
      SELECT
        w.id,
        w.week_number,
        w.start_date,
        w.end_date,
        c.closed_at
      FROM schedule_weeks w
      INNER JOIN week_closings c
        ON c.week_id = w.id
      ORDER BY w.week_number DESC
      LIMIT 1
    `,
    [],
    (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.json({ week: null, top_classes: [] })

      computeWeekScores(week.id, (scoreErr, rows) => {
        if (scoreErr) return res.status(500).json({ error: scoreErr.message })

        const scoreMap = new Map(
          (rows || []).map((row) => [String(row.class_name || "").trim().toUpperCase(), Number(row.score || 0)]),
        )

        db.all(
          `
            SELECT name, grade
            FROM classes
            WHERE is_active = 1
            ORDER BY RANDOM()
          `,
          [],
          (classErr, classes) => {
            if (classErr) return res.status(500).json({ error: classErr.message })

            const bestByGrade = new Map()

            for (const item of classes || []) {
              const grade = Number(item.grade || 0)
              if (![10, 11, 12].includes(grade)) continue

              const className = String(item.name || "").trim()
              const score = scoreMap.get(className.toUpperCase()) ?? 0
              const current = bestByGrade.get(grade)

              if (!current || score > current.score) {
                bestByGrade.set(grade, {
                  grade,
                  class_name: className,
                  score,
                })
              }
            }

            const top_classes = [10, 11, 12]
              .map((grade) => bestByGrade.get(grade))
              .filter(Boolean)

            res.json({
              week,
              top_classes,
            })
          },
        )
      })
    },
  )
})

function dutyStatusLabel(status) {
  if (status === "signed") return "Đã ký"
  if (status === "draft") return "Nháp"
  return "Không rõ"
}

function revisionActionLabel(action) {
  const a = String(action || "")
  if (a === "sign") return "Ký xác nhận"
  if (a === "sign:admin") return "Ký (Admin)"
  if (a === "edit:add_violation") return "Chỉnh sửa: thêm vi phạm"
  if (a === "edit:remove_violation") return "Chỉnh sửa: gỡ vi phạm"
  if (a === "bonus:apply_daily_bonus") return "Cộng điểm sổ đầu bài"
  return "Chỉnh sửa"
}

const DEFAULT_BASE_SCORE = 120

async function loadBaseScore() {
  const rawValue = await SystemSettingService.get("base_score", String(DEFAULT_BASE_SCORE))
  const parsedValue = Number(rawValue)
  return Number.isFinite(parsedValue) ? parsedValue : DEFAULT_BASE_SCORE
}

function withBaseScore(cb) {
  loadBaseScore()
    .then((baseScore) => cb(null, baseScore))
    .catch((err) => cb(err))
}

function latestSignatureJoin(alias = "ds") {
  // Join the most recent signature per session (supports re-signing).
  return `
    LEFT JOIN duty_signatures ${alias}
      ON ${alias}.id = (
        SELECT id
        FROM duty_signatures
        WHERE session_id = s.id
        ORDER BY id DESC
        LIMIT 1
      )
  `
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

function isSunday(dateStr) {
  // dateStr: YYYY-MM-DD
  // Interpret in local time to match time.today() behavior.
  const dt = new Date(String(dateStr) + "T00:00:00")
  return dt.getDay() === 0
}

function isWeekClosed(weekId, cb) {
  db.get(
    `SELECT week_id, closed_at FROM week_closings WHERE week_id=? LIMIT 1`,
    [weekId],
    (err, row) => {
      if (err) return cb(err)
      cb(null, !!row?.closed_at, row?.closed_at || null)
    },
  )
}

function ensureDailySessionsForDate({ weekId, date }, cb) {
  if (!weekId || !date) return cb(null, { created: 0 })

  // Insert for all assignments of the week, but only if missing for that red_class on that date.
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
        function (err) {
          if (err) {
            db.run("ROLLBACK", () => cb(err))
            return
          }
          const created = this.changes || 0
          db.run("COMMIT", (err2) => {
            if (err2) return cb(err2)
            cb(null, { created })
          })
        },
      )
    })
  })
}

function computeWeekScores(weekId, cb) {
  withBaseScore((baseErr, baseScore) => {
    if (baseErr) return cb(baseErr)

    db.all(
      `
        WITH class_list AS (
          SELECT name as class_name
          FROM classes
          WHERE is_active = 1
        ),
        session_base AS (
          SELECT
            s.id,
            s.duty_class as class_name,
            COALESCE(SUM(r.score_delta * v.quantity), 0) as violation_score,
            COALESCE(MAX(b.points), 0) as bonus_points
          FROM duty_sessions s
          LEFT JOIN duty_violations v
            ON v.session_id = s.id
          LEFT JOIN rules r
            ON r.id = v.rule_id
          LEFT JOIN daily_bonus b
            ON b.week_id = s.week_id
           AND b.date = s.date
           AND b.class_name = s.duty_class
          WHERE s.week_id=?
            AND s.status='signed'
          GROUP BY s.id
        ),
        class_totals AS (
          SELECT
            class_name,
            SUM(violation_score + bonus_points) as session_score
          FROM session_base
          GROUP BY class_name
        )
        SELECT
          cl.class_name,
          (? + COALESCE(ct.session_score, 0) + COALESCE(wb.points, 0)) as score
        FROM class_list cl
        LEFT JOIN class_totals ct
          ON ct.class_name = cl.class_name
        LEFT JOIN weekly_bonus wb
          ON wb.week_id = ?
         AND wb.class_name = cl.class_name
        ORDER BY score DESC
      `,
      [weekId, baseScore, weekId],
      cb,
    )
  })
}

function weekSessionCounts(weekId, cb) {
  db.get(
    `
      SELECT
        SUM(CASE WHEN status='signed' THEN 1 ELSE 0 END) as signed_count,
        SUM(CASE WHEN status!='signed' THEN 1 ELSE 0 END) as draft_count,
        COUNT(*) as total_count
      FROM duty_sessions
      WHERE week_id=?
    `,
    [weekId],
    (err, row) => {
      if (err) return cb(err)
      cb(null, {
        signed_count: Number(row?.signed_count || 0),
        draft_count: Number(row?.draft_count || 0),
        total_count: Number(row?.total_count || 0),
      })
    },
  )
}

function weekBreakdowns(weekId, cb) {
  withBaseScore((baseErr, baseScore) => {
    if (baseErr) return cb(baseErr)

    db.all(
      `
        WITH class_list AS (
          SELECT name as class_name, grade
          FROM classes
          WHERE is_active = 1
        ),
        signed_sessions AS (
          SELECT id, duty_class, date
          FROM duty_sessions
          WHERE week_id=?
            AND status='signed'
        ),
        daily_by_class AS (
          SELECT
            s.duty_class as class_name,
            COALESCE(SUM(b.points), 0) as daily_points,
            MIN(b.min_score) as min_score
          FROM signed_sessions s
          LEFT JOIN daily_bonus b
            ON b.week_id = ?
           AND b.date = s.date
           AND b.class_name = s.duty_class
          GROUP BY s.duty_class
        ),
        vio_by_class AS (
          SELECT
            s.duty_class as class_name,
            COALESCE(SUM(r.score_delta * v.quantity), 0) as violation_sum
          FROM signed_sessions s
          LEFT JOIN duty_violations v
            ON v.session_id = s.id
          LEFT JOIN rules r
            ON r.id = v.rule_id
          GROUP BY s.duty_class
        ),
        weekly_by_class AS (
          SELECT class_name, points as weekly_points, reason
          FROM weekly_bonus
          WHERE week_id=?
        )
        SELECT
          cl.grade,
          cl.class_name,
          ? as base_points,
          COALESCE(db.daily_points, 0) as daily_points,
          COALESCE(wb.weekly_points, 0) as weekly_points,
          COALESCE(vb.violation_sum, 0) as violation_sum,
          (? + COALESCE(db.daily_points, 0) + COALESCE(wb.weekly_points, 0)) as plus_points,
          CASE
            WHEN COALESCE(vb.violation_sum, 0) < 0 THEN -COALESCE(vb.violation_sum, 0)
            ELSE 0
          END as minus_points,
          (? + COALESCE(db.daily_points, 0) + COALESCE(wb.weekly_points, 0) + COALESCE(vb.violation_sum, 0)) as total_score,
          db.min_score as min_score,
          wb.reason as weekly_reason
        FROM class_list cl
        LEFT JOIN daily_by_class db
          ON db.class_name = cl.class_name
        LEFT JOIN vio_by_class vb
          ON vb.class_name = cl.class_name
        LEFT JOIN weekly_by_class wb
          ON wb.class_name = cl.class_name
        ORDER BY cl.grade ASC, total_score DESC, cl.class_name ASC
      `,
      [weekId, weekId, weekId, baseScore, baseScore, baseScore],
      cb,
    )
  })
}

function parseWeekIds(input) {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
  }
  const s = String(input)
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function isPeriodClosed(table, keyField, key, cb) {
  db.get(
    `SELECT closed_at FROM ${table} WHERE ${keyField}=? LIMIT 1`,
    [key],
    (err, row) => {
      if (err) return cb(err)
      cb(null, !!row?.closed_at, row?.closed_at || null)
    },
  )
}

function upsertPeriodSummary(table, keyField, key, weekIds, closedAt, cb) {
  const now = time.now()
  db.run(
    `
      INSERT INTO ${table}
      (${keyField}, week_ids, closed_at, created_at, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(${keyField})
      DO UPDATE SET
        week_ids=excluded.week_ids,
        closed_at=excluded.closed_at,
        updated_at=excluded.updated_at
    `,
    [key, JSON.stringify(weekIds || []), closedAt || null, now, now],
    (err) => cb(err),
  )
}

function loadPeriodSummary(table, keyField, key, cb) {
  if (table === "month_summaries") return loadMonthSummary(key, cb)
  if (table === "semester_summaries") return loadSemesterSummary(key, cb)
  if (table === "year_summaries") return loadYearSummary(key, cb)

  db.get(
    `SELECT ${keyField} as period_key, week_ids, closed_at, updated_at FROM ${table} WHERE ${keyField}=? LIMIT 1`,
    [key],
    (err, row) => {
      if (err) return cb(err)
      if (!row) return cb(null, null)
      let weekIds = []
      try {
        weekIds = JSON.parse(String(row.week_ids || "[]"))
      } catch { }
      cb(null, { period_key: row.period_key, week_ids: weekIds, closed_at: row.closed_at || null, updated_at: row.updated_at || null })
    },
  )
}

async function usesElectronicGradebook() {
  const raw = await SystemSettingService.get("use_electronic_gradebook", "1")
  return String(raw || "1") !== "0"
}

function ensureGradebookUploadsForWeek(weekId, cb) {
  usesElectronicGradebook()
    .then((enabled) => {
      if (!enabled) return cb(null)

      db.all(
        `
          SELECT grade, COUNT(*) as upload_count
          FROM bonus_uploads
          WHERE week_id=?
          GROUP BY grade
        `,
        [weekId],
        (err, rows) => {
          if (err) return cb(err)

          const required = ["10", "11", "12"]
          const uploaded = new Set((rows || []).map((r) => String(r.grade)))
          const missing = required.filter((g) => !uploaded.has(g))
          if (missing.length > 0) {
            const error = new Error(`Thiếu Sổ đầu bài điện tử cho khối ${missing.join(", ")}`)
            error.status = 400
            return cb(error)
          }

          cb(null)
        })
    })
    .catch((err) => cb(err))
}

function ensureWeekUnlocked(weekId, cb) {
  isWeekClosed(weekId, (err, closed) => {
    if (err) return cb(err)
    if (closed) {
      const error = new Error("Week closed")
      error.status = 403
      return cb(error)
    }
    cb(null)
  })
}

function ensureSessionWeekUnlocked(sessionId, cb) {
  db.get(
    `SELECT id, week_id FROM duty_sessions WHERE id=? LIMIT 1`,
    [sessionId],
    (err, session) => {
      if (err) return cb(err)
      if (!session) {
        const error = new Error("Session not found")
        error.status = 404
        return cb(error)
      }
      ensureWeekUnlocked(session.week_id, (lockErr) => cb(lockErr, session))
    },
  )
}

function ensureAllWeeksClosed(weekIds, cb) {
  const ids = (weekIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return cb(null)

  const placeholders = ids.map(() => "?").join(",")
  db.all(
    `
      SELECT w.id, w.week_number
      FROM schedule_weeks w
      LEFT JOIN week_closings wc
        ON wc.week_id = w.id
      WHERE w.id IN (${placeholders})
        AND wc.closed_at IS NULL
      ORDER BY w.week_number ASC, w.id ASC
    `,
    ids,
    (err, rows) => {
      if (err) return cb(err)
      if ((rows || []).length > 0) {
        const labels = rows.map((r) => r.week_number || r.id).join(", ")
        const error = new Error(`Con tuan chua khoa: ${labels}`)
        error.status = 409
        return cb(error)
      }
      cb(null)
    },
  )
}

function ensureAllMonthsClosed(monthKeys, cb) {
  const keys = (monthKeys || []).map(String).filter(Boolean)
  if (!keys.length) return cb(null)

  const placeholders = keys.map(() => "?").join(",")
  db.all(
    `
      SELECT m.month_key
      FROM months m
      LEFT JOIN month_summaries ms
        ON ms.month_key = m.month_key
      WHERE m.month_key IN (${placeholders})
        AND ms.closed_at IS NULL
      ORDER BY ${monthOrderSql("m")} ASC, m.id ASC
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      if ((rows || []).length > 0) {
        const labels = rows.map((r) => r.month_key).join(", ")
        const error = new Error(`Con thang chua khoa: ${labels}`)
        error.status = 409
        return cb(error)
      }
      cb(null)
    },
  )
}

function ensureAllSemestersClosed(semesterKeys, cb) {
  const keys = (semesterKeys || []).map(String).filter(Boolean)
  if (!keys.length) return cb(null)

  const placeholders = keys.map(() => "?").join(",")
  db.all(
    `
      SELECT (y.name || '-HK' || s.semester_number) as semester_key
      FROM semesters s
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      WHERE (y.name || '-HK' || s.semester_number) IN (${placeholders})
        AND ss.closed_at IS NULL
      ORDER BY y.name ASC, s.semester_number ASC
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      if ((rows || []).length > 0) {
        const labels = rows.map((r) => r.semester_key).join(", ")
        const error = new Error(`Con hoc ky chua khoa: ${labels}`)
        error.status = 409
        return cb(error)
      }
      cb(null)
    },
  )
}

function loadMonthSummary(key, cb) {
  db.get(
    `
      SELECT
        m.month_key,
        COALESCE(ms.week_ids, '[]') as legacy_week_ids,
        ms.closed_at,
        ms.updated_at
      FROM months m
      LEFT JOIN month_summaries ms
        ON ms.month_key = m.month_key
      WHERE m.month_key=?
      LIMIT 1
    `,
    [key],
    (err, row) => {
      if (err) return cb(err)
      const finish = (fallbackRow) => {
        loadWeekIdsForMonthKey(key, (weekErr, weekIds) => {
          if (weekErr) return cb(weekErr)
          if (!row && !fallbackRow) return cb(null, null)
          cb(null, {
            period_key: key,
            month_key: key,
            week_ids: weekIds.length ? weekIds : parseJsonList(fallbackRow?.week_ids),
            closed_at: (row || fallbackRow)?.closed_at || null,
            updated_at: (row || fallbackRow)?.updated_at || null,
          })
        })
      }

      if (row) return finish(null)

      db.get(
        `SELECT month_key, week_ids, closed_at, updated_at FROM month_summaries WHERE month_key=? LIMIT 1`,
        [key],
        (fallbackErr, fallbackRow) => {
          if (fallbackErr) return cb(fallbackErr)
          finish(fallbackRow)
        },
      )
    },
  )
}

function loadSemesterSummary(key, cb) {
  db.get(
    `
      SELECT
        s.id,
        s.semester_number,
        s.name,
        y.name as school_year_name,
        ss.week_ids as legacy_week_ids,
        ss.month_keys as legacy_month_keys,
        ss.closed_at,
        ss.updated_at
      FROM semesters s
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      WHERE (y.name || '-HK' || s.semester_number)=?
      LIMIT 1
    `,
    [key],
    (err, row) => {
      if (err) return cb(err)
      const finish = (fallbackRow) => {
        loadMonthKeysForSemesterKey(key, (monthErr, monthKeys) => {
          if (monthErr) return cb(monthErr)
          loadWeekIdsForSemesterKey(key, (weekErr, weekIds) => {
            if (weekErr) return cb(weekErr)
            if (!row && !fallbackRow) return cb(null, null)
            cb(null, {
              period_key: key,
              semester_key: key,
              week_ids: weekIds.length ? weekIds : parseJsonList(fallbackRow?.week_ids),
              month_keys: monthKeys.length ? monthKeys : parseJsonList(fallbackRow?.month_keys),
              closed_at: (row || fallbackRow)?.closed_at || null,
              updated_at: (row || fallbackRow)?.updated_at || null,
            })
          })
        })
      }

      if (row) return finish(null)

      db.get(
        `SELECT semester_key, week_ids, month_keys, closed_at, updated_at FROM semester_summaries WHERE semester_key=? LIMIT 1`,
        [key],
        (fallbackErr, fallbackRow) => {
          if (fallbackErr) return cb(fallbackErr)
          finish(fallbackRow)
        },
      )
    },
  )
}

function loadYearSummary(key, cb) {
  db.get(
    `
      SELECT
        y.name as year_key,
        ys.week_ids as legacy_week_ids,
        ys.semester_keys as legacy_semester_keys,
        ys.closed_at,
        ys.updated_at
      FROM school_years y
      LEFT JOIN year_summaries ys
        ON ys.year_key = y.name
      WHERE y.name=?
      LIMIT 1
    `,
    [key],
    (err, row) => {
      if (err) return cb(err)
      const finish = (fallbackRow) => {
        loadSemesterKeysForYearKey(key, (semesterErr, semesterKeys) => {
          if (semesterErr) return cb(semesterErr)
          loadWeekIdsForYearKey(key, (weekErr, weekIds) => {
            if (weekErr) return cb(weekErr)
            if (!row && !fallbackRow) return cb(null, null)
            cb(null, {
              period_key: key,
              year_key: key,
              week_ids: weekIds.length ? weekIds : parseJsonList(fallbackRow?.week_ids),
              semester_keys: semesterKeys.length ? semesterKeys : parseJsonList(fallbackRow?.semester_keys),
              closed_at: (row || fallbackRow)?.closed_at || null,
              updated_at: (row || fallbackRow)?.updated_at || null,
            })
          })
        })
      }

      if (row) return finish(null)

      db.get(
        `SELECT year_key, week_ids, semester_keys, closed_at, updated_at FROM year_summaries WHERE year_key=? LIMIT 1`,
        [key],
        (fallbackErr, fallbackRow) => {
          if (fallbackErr) return cb(fallbackErr)
          finish(fallbackRow)
        },
      )
    },
  )
}

function loadWeekIdsForMonthKey(monthKey, cb) {
  db.all(
    `
      SELECT w.id
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      WHERE m.month_key=?
      ORDER BY w.week_number ASC, w.start_date ASC, w.id ASC
    `,
    [monthKey],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0))
    },
  )
}

function loadMonthKeysForSemesterKey(semesterKey, cb) {
  db.all(
    `
      SELECT m.month_key
      FROM months m
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      WHERE (y.name || '-HK' || s.semester_number)=?
      ORDER BY ${monthOrderSql("m")} ASC, m.id ASC
    `,
    [semesterKey],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, (rows || []).map((r) => String(r.month_key)).filter(Boolean))
    },
  )
}

function loadSemesterKeysForYearKey(yearKey, cb) {
  db.all(
    `
      SELECT (y.name || '-HK' || s.semester_number) as semester_key
      FROM semesters s
      JOIN school_years y
        ON y.id = s.school_year_id
      WHERE y.name=?
      ORDER BY s.semester_number ASC
    `,
    [yearKey],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, (rows || []).map((r) => String(r.semester_key)).filter(Boolean))
    },
  )
}

function loadWeekIdsForSemesterKey(semesterKey, cb) {
  db.all(
    `
      SELECT w.id
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      WHERE (y.name || '-HK' || s.semester_number)=?
      ORDER BY ${monthOrderSql("m")} ASC, w.week_number ASC, w.start_date ASC, w.id ASC
    `,
    [semesterKey],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0))
    },
  )
}

function loadWeekIdsForYearKey(yearKey, cb) {
  db.all(
    `
      SELECT w.id
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      WHERE y.name=?
      ORDER BY s.semester_number ASC, ${monthOrderSql("m")} ASC, w.week_number ASC, w.start_date ASC, w.id ASC
    `,
    [yearKey],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0))
    },
  )
}

function parseJsonList(val) {
  try {
    const arr = JSON.parse(String(val || "[]"))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function loadWeekIdsForMonths(monthKeys, cb) {
  const keys = (monthKeys || []).map(String).filter(Boolean)
  if (keys.length === 0) return cb(null, [])
  const placeholders = keys.map(() => "?").join(",")
  db.all(
    `
      SELECT w.id
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      WHERE m.month_key IN (${placeholders})
      ORDER BY ${monthOrderSql("m")} ASC, w.week_number ASC, w.start_date ASC, w.id ASC
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      const ids = (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
      if (ids.length) return cb(null, ids)

      db.all(
        `
          SELECT month_key, week_ids
          FROM month_summaries
          WHERE month_key IN (${placeholders})
        `,
        keys,
        (fallbackErr, fallbackRows) => {
          if (fallbackErr) return cb(fallbackErr)
          const weekSet = new Set()
            ; (fallbackRows || []).forEach((r) => {
              parseJsonList(r.week_ids).forEach((id) => weekSet.add(Number(id)))
            })
          cb(null, Array.from(weekSet).filter((n) => Number.isFinite(n) && n > 0))
        },
      )
    },
  )
}

function loadWeekIdsForSemesters(semesterKeys, cb) {
  const keys = (semesterKeys || []).map(String).filter(Boolean)
  if (keys.length === 0) return cb(null, [])
  const placeholders = keys.map(() => "?").join(",")
  db.all(
    `
      SELECT w.id
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      WHERE (y.name || '-HK' || s.semester_number) IN (${placeholders})
      ORDER BY y.name ASC, s.semester_number ASC, ${monthOrderSql("m")} ASC, w.week_number ASC, w.id ASC
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      const ids = (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
      if (ids.length) return cb(null, ids)

      db.all(
        `
          SELECT semester_key, week_ids
          FROM semester_summaries
          WHERE semester_key IN (${placeholders})
        `,
        keys,
        (fallbackErr, fallbackRows) => {
          if (fallbackErr) return cb(fallbackErr)
          const weekSet = new Set()
            ; (fallbackRows || []).forEach((r) => {
              parseJsonList(r.week_ids).forEach((id) => weekSet.add(Number(id)))
            })
          cb(null, Array.from(weekSet).filter((n) => Number.isFinite(n) && n > 0))
        },
      )
    },
  )
}

function upsertAdjustment(adjTable, keyField, key, className, plusPoints, minusPoints, reason, cb) {
  const now = time.now()
  db.run(
    `
      INSERT INTO ${adjTable}
      (${keyField}, class_name, plus_points, minus_points, reason, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(${keyField}, class_name)
      DO UPDATE SET
        plus_points=excluded.plus_points,
        minus_points=excluded.minus_points,
        reason=excluded.reason,
        updated_at=excluded.updated_at
    `,
    [key, className, plusPoints, minusPoints, reason || "", now, now],
    (err) => cb(err),
  )
}

function loadAdjustments(adjTable, keyField, key, cb) {
  db.all(
    `
      SELECT class_name, plus_points, minus_points, reason, updated_at
      FROM ${adjTable}
      WHERE ${keyField}=?
    `,
    [key],
    (err, rows) => {
      if (err) return cb(err)
      const map = new Map()
        ; (rows || []).forEach((r) => {
          map.set(String(r.class_name), {
            class_name: String(r.class_name),
            plus_points: Number(r.plus_points || 0),
            minus_points: Number(r.minus_points || 0),
            reason: String(r.reason || ""),
            updated_at: r.updated_at || null,
          })
        })
      cb(null, map)
    },
  )
}

function deleteAdjustment(adjTable, keyField, key, className, cb) {
  db.run(
    `
      DELETE FROM ${adjTable}
      WHERE ${keyField}=?
        AND class_name=?
    `,
    [key, className],
    function (err) {
      cb(err, this?.changes || 0)
    },
  )
}

function annotateNotesAndRanks(sortedByScore) {
  let prevScore = null
  let prevRank = 0
  const ranked = sortedByScore.map((r, idx) => {
    const s = Number(r.total_score || 0)
    const rank = prevScore != null && s === prevScore ? prevRank : idx + 1
    prevScore = s
    prevRank = rank
    return { ...r, rank }
  })

  const rankCounts = new Map()
  ranked.forEach((r) => {
    const rk = Number(r.rank || 0)
    if (!rk) return
    rankCounts.set(rk, (rankCounts.get(rk) || 0) + 1)
  })

  const lastRank = ranked.reduce((m, r) => Math.max(m, Number(r.rank || 0)), 0)

  function label(base, rk) {
    const c = rankCounts.get(rk) || 0
    if (c > 1) return `ĐỒNG ${base}`
    return base
  }

  return ranked.map((r) => {
    const rk = Number(r.rank || 0)
    let note = ""
    if (rk === 1) note = label("HẠNG NHẤT", rk)
    else if (rk === 2) note = label("HẠNG NHÌ", rk)
    else if (rk === 3) note = label("HẠNG BA", rk)
    else if (rk === lastRank) note = label("HẠNG CHÓT", rk)
    return { ...r, note }
  })
}

function computePeriodFromWeeks(weekIds, adjustmentsMap, cb) {
  const ids = (weekIds || []).filter((x) => Number.isFinite(x) && x > 0)
  if (!ids.length) return cb(null, [])

  const acc = new Map()

  function mergeRows(rows) {
    ; (rows || []).forEach((r) => {
      const key = String(r.class_name)
      const cur =
        acc.get(key) || {
          grade: Number(r.grade || 0),
          class_name: key,
          base_points: 0,
          daily_points: 0,
          weekly_points: 0,
          violation_sum: 0,
          plus_points: 0,
          minus_points: 0,
          total_score: 0,
        }

      cur.base_points += Number(r.base_points || 0)
      cur.daily_points += Number(r.daily_points || 0)
      cur.weekly_points += Number(r.weekly_points || 0)
      cur.violation_sum += Number(r.violation_sum || 0)

      cur.plus_points += Number(r.plus_points || 0)
      cur.minus_points += Number(r.minus_points || 0)
      cur.total_score += Number(r.total_score || 0)

      acc.set(key, cur)
    })
  }

  // Sequentially compute per-week breakdowns (weeks per period are small).
  const next = (i) => {
    if (i >= ids.length) {
      // Apply adjustments after summing.
      acc.forEach((cur, key) => {
        const adj = adjustmentsMap?.get(key)
        const adjPlus = Number(adj?.plus_points || 0)
        const adjMinus = Number(adj?.minus_points || 0)
        cur.plus_points += adjPlus
        cur.minus_points += adjMinus
        cur.total_score += adjPlus - adjMinus
        cur.adjust_plus = adjPlus
        cur.adjust_minus = adjMinus
        cur.adjust_reason = adj?.reason || ""
      })
      cb(null, Array.from(acc.values()))
      return
    }
    weekBreakdowns(ids[i], (err, rows) => {
      if (err) return cb(err)
      mergeRows(rows)
      next(i + 1)
    })
  }

  next(0)
}

function toMonthRows(rows) {
  return (rows || []).map((r) => {
    const adjPlus = Number(r.adjust_plus || 0)
    const adjMinus = Number(r.adjust_minus || 0)
    const weekTotal = Number(r.total_score || 0) - adjPlus + adjMinus
    const monthAdjust = adjPlus - adjMinus
    const totalScore = weekTotal + monthAdjust
    return {
      ...r,
      week_total: weekTotal,
      month_adjust_points: monthAdjust,
      total_score: totalScore,
      adjust_plus: adjPlus,
      adjust_minus: adjMinus,
    }
  })
}

function normalizeMonthKey(input) {
  const s = String(input || "").trim()
  const m1 = s.match(/^(\d{2})\/(\d{4})$/)
  if (m1) {
    const month = Number(m1[1])
    if (month < 1 || month > 12) return null
    return `${m1[1]}/${m1[2]}`
  }
  const m2 = s.match(/^(\d{4})-(\d{2})$/)
  if (m2) {
    const month = Number(m2[2])
    if (month < 1 || month > 12) return null
    return `${m2[2]}/${m2[1]}`
  }
  return null
}

function monthOrderSql(alias = "m") {
  return `
    CASE
      WHEN ${alias}.month_key ~ '^\\d{2}/\\d{4}$' THEN to_date(${alias}.month_key, 'MM/YYYY')
      WHEN ${alias}.month_key ~ '^\\d{4}-\\d{2}$' THEN to_date(${alias}.month_key, 'YYYY-MM')
      ELSE NULL
    END
  `
}

function monthPeriodLabel(monthKey) {
  const normalized = normalizeMonthKey(monthKey)
  if (normalized) return `Tháng ${normalized}`
  return `Tháng ${monthKey}`
}

function romanNumeral(number) {
  const romanByNumber = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
    9: "IX",
  }
  return romanByNumber[Number(number)] || String(number || "")
}

function normalizeYearKey(input) {
  const s = String(input || "").trim()
  const m = s.match(/^(\d{4})-(\d{4})$/)
  if (!m) return null
  return `${m[1]}-${m[2]}`
}

function normalizeSemesterKey(input) {
  const s = String(input || "").trim()
  // Expect formats like "2025-2026-HK1" / "2025-2026-HK3" / "2025-2026_HK4"
  const m = s.match(/^(\d{4}-\d{4})[-_ ]?HK([1-9])$/i)
  if (!m) return null
  return `${m[1]}-HK${m[2]}`
}

function parseClassNatural(name) {
  const n = String(name || "").toUpperCase()
  const g = parseInt(n, 10) || 0
  const aPos = n.indexOf("A")
  const num = aPos >= 0 ? parseInt(n.slice(aPos + 1), 10) || 0 : 0
  return { g, num, name: n }
}

function exportExcelWorkbookForPeriod(res, opts) {
  const { fileName, periodTitleByGrade, periodLine2, rowsByGrade } = opts
  const workbook = new ExcelJS.Workbook()
  const baseFont = { name: "Times New Roman", size: 12 }

    ; ([10, 11, 12]).forEach((g) => {
      const list = (rowsByGrade[g] || []).slice()

      // Order rows by class name (10A1..), but keep rank/note computed by score.
      list.sort((a, b) => {
        const aa = parseClassNatural(a.class_name)
        const bb = parseClassNatural(b.class_name)
        if (aa.g !== bb.g) return aa.g - bb.g
        if (aa.num !== bb.num) return aa.num - bb.num
        return aa.name.localeCompare(bb.name)
      })

      const ws = workbook.addWorksheet(`Khoi ${g}`)

      ws.columns = [
        { header: "Lớp", key: "class_name", width: 10 },
        { header: "Điểm cộng", key: "plus_points", width: 14 },
        { header: "Điểm trừ", key: "minus_points", width: 14 },
        { header: "Tổng điểm", key: "total_score", width: 14 },
        { header: "Xếp hạng", key: "rank", width: 10 },
        { header: "Ghi chú", key: "note", width: 20 },
      ]

      const title = String(periodTitleByGrade(g))
      const line2 = String(periodLine2)

      ws.mergeCells("A1:F2")
      ws.getCell("A1").value = title
      ws.getCell("A1").font = { ...baseFont, bold: true }
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }

      ws.mergeCells("A3:F3")
      ws.getCell("A3").value = line2
      ws.getCell("A3").font = { ...baseFont, bold: true }
      ws.getCell("A3").alignment = { horizontal: "center", vertical: "middle" }

      const headerRow = ws.getRow(4)
      headerRow.values = ["Lớp", "Điểm cộng", "Điểm trừ", "Tổng điểm", "Xếp hạng", "Ghi chú"]
      headerRow.font = { ...baseFont, bold: true }
      headerRow.alignment = { horizontal: "center", vertical: "middle" }
      headerRow.height = 18

      let rowIndex = 5
      list.forEach((r) => {
        const row = ws.getRow(rowIndex++)
        row.getCell(1).value = String(r.class_name)
        row.getCell(2).value = Number(r.plus_points || 0)
        row.getCell(3).value = Number(r.minus_points || 0)
        row.getCell(4).value = Number(r.total_score || 0)
        row.getCell(5).value = Number(r.rank || 0)
        const note = String(r.note || "")
        row.getCell(6).value = note
        if (note) row.getCell(6).font = { ...baseFont, bold: true }
        row.height = 16
      })

      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell((cell) => {
          if (!cell.font) cell.font = { ...baseFont }
          if (!cell.alignment)
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
          cell.border = {
            top: { style: "thin", color: { argb: "FFD9E2F3" } },
            left: { style: "thin", color: { argb: "FFD9E2F3" } },
            bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
            right: { style: "thin", color: { argb: "FFD9E2F3" } },
          }
        })
      })
    })

  workbook.xlsx
    .writeBuffer()
    .then((buf) => {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
      res.send(Buffer.from(buf))
    })
    .catch((err) => {
      res.status(500).json({ error: err?.message || "Export failed" })
    })
}

function exportExcelWorkbookForMonth(res, opts) {
  const { fileName, periodTitleByGrade, periodLine2, rowsByGrade } = opts
  const workbook = new ExcelJS.Workbook()
  const baseFont = { name: "Times New Roman", size: 12 }

    ; ([10, 11, 12]).forEach((g) => {
      const list = (rowsByGrade[g] || []).slice()

      list.sort((a, b) => {
        const aa = parseClassNatural(a.class_name)
        const bb = parseClassNatural(b.class_name)
        if (aa.g !== bb.g) return aa.g - bb.g
        if (aa.num !== bb.num) return aa.num - bb.num
        return aa.name.localeCompare(bb.name)
      })

      const ws = workbook.addWorksheet(`Khoi ${g}`)
      ws.columns = [
        { header: "Lớp", key: "class_name", width: 10 },
        { header: "Tổng tuần", key: "week_total", width: 14 },
        { header: "Cộng, trừ tháng", key: "month_adjust_points", width: 16 },
        { header: "Tổng điểm", key: "total_score", width: 14 },
        { header: "Xếp hạng", key: "rank", width: 10 },
        { header: "Ghi chú", key: "note", width: 20 },
      ]

      const title = String(periodTitleByGrade(g))
      const line2 = String(periodLine2)

      ws.mergeCells("A1:F2")
      ws.getCell("A1").value = title
      ws.getCell("A1").font = { ...baseFont, bold: true }
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
      ws.getCell("A1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFA500" },
      }

      ws.mergeCells("A3:F3")
      ws.getCell("A3").value = line2
      ws.getCell("A3").font = { ...baseFont, bold: true }
      ws.getCell("A3").alignment = { horizontal: "center", vertical: "middle" }
      ws.getCell("A3").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF91D14E" },
      }

      const headerRow = ws.getRow(4)
      headerRow.values = ["Lớp", "Tổng tuần", "Cộng, trừ tháng", "Tổng điểm", "Xếp hạng", "Ghi chú"]
      headerRow.font = { ...baseFont, bold: true }
      headerRow.alignment = { horizontal: "center", vertical: "middle" }
      headerRow.height = 18

      let rowIndex = 5
      list.forEach((r) => {
        const row = ws.getRow(rowIndex++)
        row.getCell(1).value = String(r.class_name)
        row.getCell(2).value = Number(r.week_total || 0)
        row.getCell(3).value = Number(r.month_adjust_points || 0)
        row.getCell(4).value = Number(r.total_score || 0)
        row.getCell(5).value = Number(r.rank || 0)
        const note = String(r.note || "").toUpperCase()
        row.getCell(6).value = note
        if (note) row.getCell(6).font = { ...baseFont, bold: true }

        const noteUpper = note
        let fill = null
        if (noteUpper.includes("HẠNG NHẤT")) {
          fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } }
        } else if (noteUpper.includes("HẠNG NHÌ")) {
          fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0170C1" } }
        } else if (noteUpper.includes("HẠNG BA")) {
          fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0FAFED" } }
        } else if (noteUpper.includes("HẠNG CHÓT")) {
          fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }
        }
        if (fill) {
          for (let c = 1; c <= 6; c += 1) {
            const cell = row.getCell(c)
            cell.fill = fill
            cell.font = { ...baseFont, bold: true }
          }
        }
        row.height = 16
      })

      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell((cell) => {
          if (!cell.font) cell.font = { ...baseFont }
          if (!cell.alignment) {
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
          }
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          }
        })
      })
    })

  workbook.xlsx
    .writeBuffer()
    .then((buf) => {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
      res.send(Buffer.from(buf))
    })
    .catch((err) => {
      res.status(500).json({ error: err?.message || "Export failed" })
    })
}

function writeWeeklyScores(weekId, rows, cb) {
  ; (async () => {
    try {
      await db.withTransaction(async () => {
        await db.run("DELETE FROM weekly_scores WHERE week_id=?", [weekId])
        for (const r of rows || []) {
          await db.run(
            `
              INSERT INTO weekly_scores
              (week_id,class_name,score,updated_at)
              VALUES(?,?,?,?)
            `,
            [weekId, r.class_name, r.score, time.now()],
          )
        }
      })
      cb(null)
    } catch (err) {
      cb(err)
    }
  })()
}

function periodToRowsByGrade(rows) {
  const grouped = { 10: [], 11: [], 12: [] }

  for (const row of rows || []) {
    const grade = Number(row.grade || 0)
    if (!grouped[grade]) grouped[grade] = []
    grouped[grade].push({
      ...row,
      total_score: Number(row.total_score || 0),
      plus_points: Number(row.plus_points || 0),
      minus_points: Number(row.minus_points || 0),
    })
  }

  Object.keys(grouped).forEach((grade) => {
    const sorted = grouped[grade].sort((a, b) => {
      const ds = Number(b.total_score || 0) - Number(a.total_score || 0)
      if (ds !== 0) return ds
      const aa = parseClassNatural(a.class_name)
      const bb = parseClassNatural(b.class_name)
      if (aa.g !== bb.g) return aa.g - bb.g
      if (aa.num !== bb.num) return aa.num - bb.num
      return aa.name.localeCompare(bb.name)
    })
    grouped[grade] = annotateNotesAndRanks(sorted)
  })

  return grouped
}

function writePeriodScores(table, keyField, key, rowsByGrade, cb) {
  ; (async () => {
    try {
      await db.withTransaction(async () => {
        await db.run(`DELETE FROM ${table} WHERE ${keyField}=?`, [key])

        const grades = Object.keys(rowsByGrade || {})
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b)

        for (const grade of grades) {
          for (const row of rowsByGrade[grade] || []) {
            await db.run(
              `
                INSERT INTO ${table}
                (${keyField}, class_name, grade, plus_points, minus_points, total_score, rank, note, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(${keyField}, class_name)
                DO UPDATE SET
                  grade=excluded.grade,
                  plus_points=excluded.plus_points,
                  minus_points=excluded.minus_points,
                  total_score=excluded.total_score,
                  rank=excluded.rank,
                  note=excluded.note,
                  updated_at=excluded.updated_at
              `,
              [
                key,
                row.class_name,
                Number(row.grade || grade || 0),
                Number(row.plus_points || 0),
                Number(row.minus_points || 0),
                Number(row.total_score || 0),
                Number(row.rank || 0),
                String(row.note || ""),
                time.now(),
              ],
            )
          }
        }
      })
      cb(null)
    } catch (err) {
      cb(err)
    }
  })()
}

function loadPeriodScores(table, keyField, key, cb) {
  db.all(
    `
      SELECT
        ${keyField} as period_key,
        class_name,
        grade,
        plus_points,
        minus_points,
        total_score,
        rank,
        note,
        updated_at
      FROM ${table}
      WHERE ${keyField}=?
      ORDER BY grade ASC, rank ASC, total_score DESC, class_name ASC
    `,
    [key],
    (err, rows) => {
      if (err) return cb(err)
      cb(null, rows || [])
    },
  )
}

function classGrade(className) {
  const grade = parseInt(String(className || "").trim(), 10)
  return Number.isFinite(grade) ? grade : 0
}

function findClassSummary(scoresByGrade, className) {
  const normalized = String(className || "").trim().toUpperCase()
  const grade = classGrade(normalized)
  const rows = scoresByGrade?.[grade] || []
  return rows.find((row) => String(row.class_name || "").trim().toUpperCase() === normalized) || null
}

function buildClassPeriodPayload({ periodType, key, meta, scoresByGrade, className }) {
  const grade = classGrade(className)
  const ranking = scoresByGrade?.[grade] || []
  const mySummary = findClassSummary(scoresByGrade, className)

  return {
    period_type: periodType,
    period_key: key,
    closed_at: meta?.closed_at || null,
    week_ids: meta?.week_ids || [],
    month_keys: meta?.month_keys || [],
    semester_keys: meta?.semester_keys || [],
    scores_by_grade: scoresByGrade,
    ranking,
    my_summary: mySummary,
    stats: {
      class_count: ranking.length,
      week_count: (meta?.week_ids || []).length,
      month_count: (meta?.month_keys || []).length,
      semester_count: (meta?.semester_keys || []).length,
      my_rank: mySummary?.rank || null,
    },
  }
}

function loadComputedPeriodSummary(periodType, key, cb) {
  const configByType = {
    month: {
      keyField: "month_key",
      scoreTable: "month_scores",
      adjustmentTable: "month_adjustments",
      loadSummary: loadMonthSummary,
      transformRows: toMonthRows,
    },
    semester: {
      keyField: "semester_key",
      scoreTable: "semester_scores",
      adjustmentTable: "semester_adjustments",
      loadSummary: loadSemesterSummary,
      transformRows: (rows) => rows || [],
    },
    year: {
      keyField: "year_key",
      scoreTable: "year_scores",
      adjustmentTable: "year_adjustments",
      loadSummary: loadYearSummary,
      transformRows: (rows) => rows || [],
    },
  }
  const config = configByType[periodType]
  if (!config) return cb(Object.assign(new Error("Invalid period"), { status: 400 }))

  config.loadSummary(key, (metaErr, meta) => {
    if (metaErr) return cb(metaErr)
    if (!meta) return cb(Object.assign(new Error("Period not found"), { status: 404 }))

    if (meta.closed_at) {
      return loadPeriodScores(config.scoreTable, config.keyField, key, (scoreErr, scores) => {
        if (scoreErr) return cb(scoreErr)
        cb(null, { meta, scores_by_grade: periodToRowsByGrade(scores || []) })
      })
    }

    const weekIds = meta.week_ids || []
    if (!weekIds.length) {
      return cb(null, { meta, scores_by_grade: periodToRowsByGrade([]) })
    }

    loadAdjustments(config.adjustmentTable, config.keyField, key, (adjustErr, adjustments) => {
      if (adjustErr) return cb(adjustErr)
      computePeriodFromWeeks(weekIds, adjustments, (computeErr, rawRows) => {
        if (computeErr) return cb(computeErr)
        const rows = config.transformRows(rawRows || [])
        cb(null, { meta, scores_by_grade: periodToRowsByGrade(rows) })
      })
    })
  })
}

function loadComputedWeekSummary(weekId, cb) {
  db.get(`SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`, [weekId], (weekErr, week) => {
    if (weekErr) return cb(weekErr)
    if (!week) return cb(Object.assign(new Error("Week not found"), { status: 404 }))

    isWeekClosed(weekId, (closedErr, closed, closedAt) => {
      if (closedErr) return cb(closedErr)
      weekBreakdowns(weekId, (breakdownErr, rows) => {
        if (breakdownErr) return cb(breakdownErr)
        const scoresByGrade = periodToRowsByGrade(rows || [])
        const scores = []
        Object.keys(scoresByGrade).forEach((grade) => {
          ; (scoresByGrade[grade] || []).forEach((row) => {
            scores.push({
              class_name: row.class_name,
              score: Number(row.total_score || 0),
              rank: row.rank,
              updated_at: null,
            })
          })
        })
        cb(null, {
          week,
          closed_at: closed ? closedAt || null : null,
          scores_by_grade: scoresByGrade,
          scores: closed ? scores : [],
        })
      })
    })
  })
}

async function loadCurrentPeriodTree() {
  const configuredYear =
    normalizeYearKey(await SystemSettingService.get("school_year", "2026-2027")) || "2026-2027"

  const schoolYear =
    (await db.get(
      `
        SELECT id, name as year_key, start_year, end_year
        FROM school_years
        WHERE name=?
        LIMIT 1
      `,
      [configuredYear],
    )) || { id: null, year_key: configuredYear }

  const semesters = await db.all(
    `
      SELECT
        s.id,
        s.school_year_id,
        s.semester_number,
        s.name,
        (y.name || '-HK' || s.semester_number) as semester_key,
        ss.closed_at
      FROM semesters s
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      WHERE y.name=?
      ORDER BY s.semester_number ASC, s.id ASC
    `,
    [configuredYear],
  )

  const months = await db.all(
    `
      SELECT
        m.id,
        m.semester_id,
        m.month_number,
        m.month_key,
        m.name,
        (y.name || '-HK' || s.semester_number) as semester_key,
        ms.closed_at
      FROM months m
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN month_summaries ms
        ON ms.month_key = m.month_key
      WHERE y.name=?
      ORDER BY s.semester_number ASC, ${monthOrderSql("m")} ASC, m.id ASC
    `,
    [configuredYear],
  )

  const weeks = await db.all(
    `
      SELECT
        w.id,
        w.week_number,
        w.start_date,
        w.end_date,
        w.month_id,
        m.month_key,
        (y.name || '-HK' || s.semester_number) as semester_key,
        wc.closed_at
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN week_closings wc
        ON wc.week_id = w.id
      WHERE y.name=?
      ORDER BY s.semester_number ASC, ${monthOrderSql("m")} ASC, w.week_number ASC, w.start_date ASC, w.id ASC
    `,
    [configuredYear],
  )

  const weeksByMonth = new Map()
    ; (weeks || []).forEach((week) => {
      const key = String(week.month_key)
      if (!weeksByMonth.has(key)) weeksByMonth.set(key, [])
      weeksByMonth.get(key).push(week)
    })

  const monthsBySemester = new Map()
    ; (months || []).forEach((month) => {
      const key = String(month.semester_key)
      if (!monthsBySemester.has(key)) monthsBySemester.set(key, [])
      monthsBySemester.get(key).push({
        ...month,
        weeks: weeksByMonth.get(String(month.month_key)) || [],
      })
    })

  return {
    school_year: schoolYear,
    semesters: (semesters || []).map((semester) => ({
      ...semester,
      months: monthsBySemester.get(String(semester.semester_key)) || [],
    })),
  }
}

function computeViolationHash(sessionId, cb) {
  db.all(
    `
      SELECT rule_id, quantity, note
      FROM duty_violations
      WHERE session_id=?
      ORDER BY rule_id ASC, note ASC, id ASC
    `,
    [sessionId],
    (err, rows) => {
      if (err) return cb(err)
      const normalized = rows.map((r) => ({
        rule_id: Number(r.rule_id),
        quantity: Number(r.quantity || 0),
        note: String(r.note || ""),
      }))
      const json = JSON.stringify(normalized)
      const hash = crypto.createHash("sha256").update(json).digest("hex")
      cb(null, hash)
    },
  )
}

function ensureSignedSnapshot(sessionId, cb) {
  db.get(
    `SELECT status, signed_snapshot_hash FROM duty_sessions WHERE id=? LIMIT 1`,
    [sessionId],
    (err, row) => {
      if (err) return cb(err)
      if (!row) return cb(null, { ensured: false })
      if (row.status !== "signed" || row.signed_snapshot_hash) {
        return cb(null, { ensured: false, hash: row.signed_snapshot_hash || null })
      }

      computeViolationHash(sessionId, (err, hash) => {
        if (err) return cb(err)
        db.run(
          `UPDATE duty_sessions SET signed_snapshot_hash=? WHERE id=?`,
          [hash, sessionId],
          (err) => {
            if (err) return cb(err)
            cb(null, { ensured: true, hash })
          },
        )
      })
    },
  )
}

function syncSignedStatusAfterChange(sessionId, action, cb) {
  db.get(
    `SELECT status, signed_snapshot_hash FROM duty_sessions WHERE id=? LIMIT 1`,
    [sessionId],
    (err, row) => {
      if (err) return cb(err)
      if (!row || !row.signed_snapshot_hash) return cb(null, { changed: false })

      computeViolationHash(sessionId, (err, hash) => {
        if (err) return cb(err)

        if (hash === row.signed_snapshot_hash) {
          if (row.status === "signed") return cb(null, { changed: false })
          db.get(
            `
              SELECT signed_at
              FROM duty_signatures
              WHERE session_id=?
              ORDER BY id DESC
              LIMIT 1
            `,
            [sessionId],
            (err, sig) => {
              if (err) return cb(err)
              const signedAt = sig?.signed_at || time.now()
              db.run(
                `UPDATE duty_sessions SET status='signed', signed_at=? WHERE id=?`,
                [signedAt, sessionId],
                (err) => {
                  if (err) return cb(err)
                  cb(null, { changed: true, restored: true })
                },
              )
            },
          )
          return
        }

        if (row.status !== "signed") return cb(null, { changed: false })
        db.run(
          `UPDATE duty_sessions SET status='draft', signed_at=NULL WHERE id=?`,
          [sessionId],
          (err) => {
            if (err) return cb(err)
            db.run(
              `
                INSERT INTO duty_revision_logs
                (session_id,action,created_at)
                VALUES(?,?,?)
              `,
              [sessionId, action, time.now()],
              (err) => {
                if (err) return cb(err)
                cb(null, { changed: true })
              },
            )
          },
        )
      })
    },
  )
}

function aggregateSessions(whereSql, params, cb) {

  db.all(
    `
      SELECT
        s.id,
        s.week_id,
        s.date,
        s.red_class,
        s.duty_class,
        s.status,
        s.created_at,
        s.signed_at,
        ds.photo_path as signature_photo_path,
        COALESCE(SUM(r.score_delta * v.quantity), 0) as violation_score,
        COALESCE(MAX(b.points), 0) as bonus_points,
        COALESCE(SUM(r.score_delta * v.quantity), 0) + COALESCE(MAX(b.points), 0) as total_score
      FROM duty_sessions s
      LEFT JOIN duty_violations v
        ON v.session_id = s.id
      LEFT JOIN rules r
        ON r.id = v.rule_id
      LEFT JOIN daily_bonus b
        ON b.week_id = s.week_id
       AND b.date = s.date
       AND b.class_name = s.duty_class
      ${latestSignatureJoin("ds")}
      ${whereSql}
      GROUP BY
        s.id,
        s.week_id,
        s.date,
        s.red_class,
        s.duty_class,
        s.status,
        s.created_at,
        s.signed_at,
        ds.photo_path
      ORDER BY s.date DESC, s.id DESC
    `,
    params,
    cb
  )

}


/*
GET CURRENT DUTY SESSION
*/
router.get(
  "/current",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const today = time.today()
    const redClass = req.session.user?.class_name

    getWeekForDate(today, (err, week) => {

      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.json({})

      isWeekClosed(week.id, (err, closed) => {
        if (err) return res.status(500).json({ error: err.message })
        // Auto-create today's sessions for all assignments (non-Sunday) when the new day starts.
        if (!closed && !isSunday(today)) {
          ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
        }
      })

      db.get(`
      SELECT
        s.*,
        COALESCE(b.points, 0) as bonus_points,
        b.min_score as bonus_min_score,
        b.source as bonus_source,
        ds.photo_path as signature_photo_path,
        ds.signed_at as signature_signed_at
      FROM duty_sessions s
      LEFT JOIN daily_bonus b
        ON b.week_id = s.week_id
       AND b.date = s.date
       AND b.class_name = s.duty_class
      ${latestSignatureJoin("ds")}
      WHERE s.date=?
        AND s.red_class=?
        AND s.week_id=?
      ORDER BY s.id DESC
      LIMIT 1
    `,
        [today, redClass, week.id],
        (err, session) => {

          if (err) return res.status(500).json({ error: err.message })

          if (!session) {
            return res.json({})
          }

          db.all(`
        SELECT v.id,v.rule_id,v.quantity,v.note,
               r.name,r.score_delta
        FROM duty_violations v
        LEFT JOIN rules r
        ON r.id=v.rule_id
        WHERE v.session_id=?
        ORDER BY v.id DESC
      `,
            [session.id],
            (err, violations) => {

              res.json({
                session,
                violations
              })

            })

        })

    })

  })


/*
CREATE DUTY SESSION
*/
router.post(
  "/create",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const today = time.today()
    const redClass = req.session.user?.class_name
    if (!redClass) return res.status(400).json({ error: "Missing class" })

    getWeekForDate(today, (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(400).json({ error: "No active week" })

      isWeekClosed(week.id, (err, closed) => {
        if (err) return res.status(500).json({ error: err.message })
        if (closed) return res.status(403).json({ error: "Week closed" })

        // Enforce schedule assignment for this week.
        db.get(
          `
          SELECT duty_class
          FROM schedule_assignments
          WHERE week_id=?
            AND red_class=?
          LIMIT 1
        `,
          [week.id, redClass],
          (err, row) => {
            if (err) return res.status(500).json({ error: err.message })
            const dutyClass = row?.duty_class
            if (!dutyClass) {
              return res.status(400).json({ error: "No assignment" })
            }

            // Idempotent create: a class can only have one duty session per day.
            db.get(
              `
      SELECT id
      FROM duty_sessions
      WHERE date=?
        AND red_class=?
        AND week_id=?
      ORDER BY id DESC
      LIMIT 1
    `,
              [today, redClass, week.id],
              (err, existing) => {

                if (err) {
                  return res.status(500).json({ error: err.message })
                }

                if (existing) {
                  return res.json({
                    success: true,
                    existing: true,
                    session_id: existing.id
                  })
                }

                db.run(`
        INSERT INTO duty_sessions
        (week_id,date,red_class,duty_class,status,created_at)
        VALUES(?,?,?,?,?,?)
      `,
                  [
                    week.id,
                    today,
                    redClass,
                    dutyClass,
                    "draft",
                    time.now()
                  ],
                  function (err) {

                    if (err) {
                      return res.status(500).json({ error: err.message })
                    }

                    res.json({
                      success: true,
                      existing: false,
                      session_id: this.lastID
                    })

                  })

              }
            )
          }
        )
      })
    })
  })

/*
CO_DO: sessions of my duty_class in current week
*/
router.get(
  "/my/week",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const today = time.today()
    const redClass = req.session.user?.class_name
    if (!redClass) return res.status(400).json({ error: "Missing class" })

    getWeekForDate(today, (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(400).json({ error: "No active week" })

      isWeekClosed(week.id, (err, closed) => {
        if (!err && !closed && !isSunday(today)) {
          ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
        }
      })

      db.get(
        `
          SELECT duty_class
          FROM schedule_assignments
          WHERE week_id=?
            AND red_class=?
          LIMIT 1
        `,
        [week.id, redClass],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message })
          const dutyClass = row?.duty_class || null
          if (!dutyClass) return res.json({ week, duty_class: null, sessions: [] })

          aggregateSessions(
            "WHERE s.week_id=? AND s.duty_class=?",
            [week.id, dutyClass],
            (err3, rows) => {
              if (err3) return res.status(500).json({ error: err3.message })
              res.json({ week, duty_class: dutyClass, sessions: rows })
            },
          )
        },
      )
    })

  }
)

/*
CO_DO: list all weeks (for selection)
*/
router.get(
  "/co_do/weeks",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {
    db.all(
      `
        SELECT w.id, w.week_number, w.start_date, w.end_date, c.closed_at
        FROM schedule_weeks w
        LEFT JOIN week_closings c
          ON c.week_id = w.id
        ORDER BY w.week_number DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ weeks: rows || [] })
      },
    )
  },
)

/*
CO_DO: sessions of my duty_class in a specific week
*/
router.get(
  "/co_do/week/:weekId",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    const redClass = req.session.user?.class_name
    if (!weekId) return res.status(400).json({ error: "Invalid week" })
    if (!redClass) return res.status(400).json({ error: "Missing class" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        const today = time.today()
        const isCurrentWeek = week.start_date <= today && today <= week.end_date

        isWeekClosed(week.id, (err, closed) => {
          if (!err && !closed && isCurrentWeek && !isSunday(today)) {
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
          }

          db.get(
            `
              SELECT duty_class
              FROM schedule_assignments
              WHERE week_id=?
                AND red_class=?
              LIMIT 1
            `,
            [week.id, redClass],
            (err2, row) => {
              if (err2) return res.status(500).json({ error: err2.message })
              const dutyClass = row?.duty_class || null
              if (!dutyClass) return res.json({ week, duty_class: null, sessions: [] })

              aggregateSessions(
                "WHERE s.week_id=? AND s.duty_class=?",
                [week.id, dutyClass],
                (err3, rows) => {
                  if (err3) return res.status(500).json({ error: err3.message })
                  res.json({ week, duty_class: dutyClass, sessions: rows || [] })
                },
              )
            },
          )
        })
      },
    )
  },
)

/*
CO_DO: session detail for my duty_class (any day in my week history)
*/
router.get(
  "/my/session/:id",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const id = req.params.id
    const redClass = req.session.user?.class_name

    db.get(
      `
        SELECT
          s.*,
          COALESCE(b.points, 0) as bonus_points,
          b.min_score as bonus_min_score,
          b.source as bonus_source,
          ds.photo_path as signature_photo_path,
          ds.signed_at as signature_signed_at
        FROM duty_sessions s
        JOIN schedule_assignments a
          ON a.week_id = s.week_id
         AND a.red_class = ?
         AND a.duty_class = s.duty_class
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        ${latestSignatureJoin("ds")}
        WHERE s.id=?
        LIMIT 1
      `,
      [redClass, id],
      (err, session) => {

        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        db.get(
          `SELECT id,week_number,start_date,end_date FROM schedule_weeks WHERE id=? LIMIT 1`,
          [session.week_id],
          (err, week) => {
            if (err) return res.status(500).json({ error: err.message })

            db.all(
              `
                SELECT v.id,v.rule_id,v.quantity,v.note,
                       r.category,r.name,r.score_delta
                FROM duty_violations v
                LEFT JOIN rules r
                  ON r.id=v.rule_id
                WHERE v.session_id=?
                ORDER BY v.id DESC
              `,
              [id],
              (err, violations) => {
                if (err) return res.status(500).json({ error: err.message })
                res.json({ session, week: week || null, violations })
              }
            )
          },
        )

      }
    )

  }
)


/*
ADD VIOLATION
*/
router.post(
  "/violation",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const { session_id, rule_id, quantity, note } = req.body

    const redClass = req.session.user?.class_name

    if (!session_id || !rule_id) {
      return res.status(400).json({ error: "Missing fields" })
    }

    db.get(
      `
      SELECT id, week_id
      FROM duty_sessions
      WHERE id=?
        AND red_class=?
      LIMIT 1
    `,
      [session_id, redClass],
      (err, row) => {

        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Session not found" })

        isWeekClosed(row.week_id, (err, closed) => {
          if (err) return res.status(500).json({ error: err.message })
          if (closed) return res.status(403).json({ error: "Week closed" })

          const q = Number(quantity || 1)
          const n = String(note || "").trim()

          ensureSignedSnapshot(session_id, (err) => {
            if (err) return res.status(500).json({ error: err.message })

            // Smart merge: same rule_id + same note => increase quantity instead of new row.
            db.get(
              `
              SELECT id, quantity
              FROM duty_violations
              WHERE session_id=?
                AND rule_id=?
                AND note=?
              ORDER BY id DESC
              LIMIT 1
            `,
              [session_id, rule_id, n],
              (err, existing) => {

                if (err) return res.status(500).json({ error: err.message })

                const finalize = (payload) => {
                  syncSignedStatusAfterChange(session_id, "edit:add_violation", (err) => {
                    if (err) return res.status(500).json({ error: err.message })
                    res.json(payload)
                  })
                }

                if (existing) {
                  db.run(
                    `UPDATE duty_violations SET quantity=? WHERE id=?`,
                    [Number(existing.quantity || 0) + q, existing.id],
                    (err) => {
                      if (err) return res.status(500).json({ error: err.message })
                      finalize({ success: true, merged: true, id: existing.id })
                    },
                  )
                  return
                }

                db.run(
                  `
                  INSERT INTO duty_violations
                  (session_id,rule_id,quantity,note)
                  VALUES(?,?,?,?)
                `,
                  [session_id, rule_id, q, n],
                  function (err) {
                    if (err) return res.status(500).json({ error: err.message })
                    finalize({ success: true, merged: false, id: this.lastID })
                  },
                )

              }
            )
          })
        })

      }
    )

  })


/*
DELETE VIOLATION
*/
router.delete(
  "/violation/:id",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {

    const id = req.params.id
    const redClass = req.session.user?.class_name

    db.get(
      `
      SELECT v.id, v.session_id, s.week_id
      FROM duty_violations v
      JOIN duty_sessions s
        ON s.id = v.session_id
      WHERE v.id=?
        AND s.red_class=?
      LIMIT 1
    `,
      [id, redClass],
      (err, row) => {

        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Violation not found" })

        isWeekClosed(row.week_id, (err, closed) => {
          if (err) return res.status(500).json({ error: err.message })
          if (closed) return res.status(403).json({ error: "Week closed" })

          ensureSignedSnapshot(row.session_id, (err) => {
            if (err) return res.status(500).json({ error: err.message })

            db.run(
              "DELETE FROM duty_violations WHERE id=?",
              [id],
              (err) => {
                if (err) return res.status(500).json({ error: err.message })

                syncSignedStatusAfterChange(row.session_id, "edit:remove_violation", (err) => {
                  if (err) return res.status(500).json({ error: err.message })
                  res.json({ success: true })
                })
              },
            )
          })
        })

      }
    )

  })

/*
ADMIN: add violation (no status change)
*/
router.post(
  "/admin/violation",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const { session_id, rule_id, quantity, note } = req.body
    if (!session_id || !rule_id) {
      return res.status(400).json({ error: "Missing fields" })
    }

    const q = Number(quantity || 1)
    const n = String(note || "").trim()

    db.get(
      `SELECT id, week_id FROM duty_sessions WHERE id=? LIMIT 1`,
      [session_id],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        ensureWeekUnlocked(session.week_id, (lockErr) => {
          if (lockErr) return res.status(lockErr.status || 500).json({ error: lockErr.message })
          db.run(
            `
            INSERT INTO duty_violations
            (session_id, rule_id, quantity, note)
            VALUES(?,?,?,?)
          `,
            [session_id, rule_id, q, n],
            function (err) {
              if (err) return res.status(500).json({ error: err.message })
              db.run(
                `INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES(?,?,?)`,
                [session_id, "edit:add_violation", time.now()],
                () => { },
              )
              res.json({ success: true, id: this.lastID })
            },
          )
        })
      },
    )
  },
)

/*
ADMIN: update violation (no status change)
*/
router.put(
  "/admin/violation/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const id = req.params.id
    const { rule_id, quantity, note } = req.body
    const q = Number(quantity || 1)
    const n = String(note || "").trim()

    db.get(
      `
        SELECT v.id, v.session_id, s.week_id
        FROM duty_violations v
        JOIN duty_sessions s
          ON s.id = v.session_id
        WHERE v.id=?
        LIMIT 1
      `,
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Violation not found" })

        ensureWeekUnlocked(row.week_id, (lockErr) => {
          if (lockErr) return res.status(lockErr.status || 500).json({ error: lockErr.message })
          db.run(
            `
            UPDATE duty_violations
            SET rule_id=?, quantity=?, note=?
            WHERE id=?
          `,
            [rule_id, q, n, id],
            (err) => {
              if (err) return res.status(500).json({ error: err.message })
              db.run(
                `INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES(?,?,?)`,
                [row.session_id, "edit:update_violation", time.now()],
                () => { },
              )
              res.json({ success: true })
            },
          )
        })
      },
    )
  },
)

/*
ADMIN: delete violation (no status change)
*/
router.delete(
  "/admin/violation/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const id = req.params.id
    db.get(
      `
        SELECT v.id, v.session_id, s.week_id
        FROM duty_violations v
        JOIN duty_sessions s
          ON s.id = v.session_id
        WHERE v.id=?
        LIMIT 1
      `,
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Violation not found" })

        ensureWeekUnlocked(row.week_id, (lockErr) => {
          if (lockErr) return res.status(lockErr.status || 500).json({ error: lockErr.message })
          db.run(
            `DELETE FROM duty_violations WHERE id=?`,
            [id],
            (err) => {
              if (err) return res.status(500).json({ error: err.message })
              db.run(
                `INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES(?,?,?)`,
                [row.session_id, "edit:remove_violation", time.now()],
                () => { },
              )
              res.json({ success: true })
            },
          )
        })
      },
    )
  },
)


/*
SIGN DUTY
*/
router.post(
  "/sign",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {
    const { session_id, pin, photo_data } = req.body

    // photo_data is optional (fallback mode) - PIN is the real authorization.
    if (!session_id || !pin) {
      return res.status(400).json({ error: "Missing fields" })
    }

    const redClass = req.session.user?.class_name
    const provided = String(pin || "").trim()

    if (!/^\d{6}$/.test(provided)) {
      return res.status(400).json({ error: "Invalid pin" })
    }

    const nowMs = Date.now()

    db.get(
      `
        SELECT *
        FROM duty_sessions
        WHERE id=?
          AND red_class=?
        LIMIT 1
      `,
      [session_id, redClass],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        const dutyClass = session.duty_class
        const weekId = session.week_id

        isWeekClosed(weekId, (closedErr, closed) => {
          if (closedErr) return res.status(500).json({ error: closedErr.message })
          if (closed) return res.status(403).json({ error: "Week closed" })

          db.get(
            `
              SELECT
                a.pin_bcs,
                COALESCE(a.pin_failed_attempts, 0) AS pin_failed_attempts,
                COALESCE(a.pin_locked_until, 0) AS pin_locked_until,
                a.class_id AS account_class_id
              FROM classes c
              LEFT JOIN accounts a
                ON a.class_id = c.id
              WHERE c.name=?
              LIMIT 1
            `,
            [dutyClass],
            async (pinErr, row) => {
              if (pinErr) return res.status(500).json({ error: pinErr.message })

              const expected = String(row?.pin_bcs || "").trim()
              const accountClassId = row?.account_class_id

              if (!accountClassId || !expected) {
                return res.status(403).json({ error: "Invalid pin" })
              }

              if (Number(row?.pin_locked_until || 0) > nowMs) {
                return res.status(429).json({ error: "Invalid pin" })
              }

              let ok = false
              try {
                ok = await bcrypt.compare(provided, expected)
              } catch (compareErr) {
                return res.status(500).json({ error: compareErr.message })
              }

              if (!ok) {
                const attempts = Number(row?.pin_failed_attempts || 0) + 1
                const lockedUntil = attempts >= 5 ? nowMs + 5 * 60 * 1000 : 0

                db.run(
                  `
                    UPDATE accounts
                    SET pin_failed_attempts = ?,
                        pin_locked_until = ?
                    WHERE class_id = ?
                  `,
                  [attempts >= 5 ? 5 : attempts, lockedUntil, accountClassId],
                  (lockErr) => {
                    if (lockErr) {
                      return res.status(500).json({ error: lockErr.message })
                    }
                    return res.status(403).json({ error: "Invalid pin" })
                  },
                )
                return
              }

              const proceedWithSignature = () => {
                let photoPath = null

                // Optional photo (fallback). If provided, save it; otherwise keep NULL.
                if (typeof photo_data === "string" && photo_data.trim()) {
                  let base64Data = null

                  if (photo_data.startsWith("data:image/jpeg;base64,")) {
                    base64Data = photo_data.replace("data:image/jpeg;base64,", "")
                  } else if (photo_data.startsWith("data:image/png;base64,")) {
                    base64Data = photo_data.replace("data:image/png;base64,", "")
                  } else {
                    return res.status(400).json({ error: "Invalid photo" })
                  }

                  let buf
                  try {
                    buf = Buffer.from(base64Data, "base64")
                  } catch {
                    return res.status(400).json({ error: "Invalid photo" })
                  }

                  const assetsDir = path.join(__dirname, "../../assets")
                  fs.mkdirSync(assetsDir, { recursive: true })

                  const filename = `duty_${session_id}_${Date.now()}_${Math.random()
                    .toString(16)
                    .slice(2)}.jpg`

                  const absPath = path.join(assetsDir, filename)

                  try {
                    fs.writeFileSync(absPath, buf)
                  } catch (saveErr) {
                    return res.status(500).json({ error: "Cannot save photo" })
                  }

                  photoPath = `/assets/${filename}`
                }

                db.run(
                  `
                    INSERT INTO duty_signatures
                    (session_id,photo_path,signed_at)
                    VALUES(?,?,?)
                  `,
                  [session_id, photoPath, time.now()],
                  (signatureErr) => {
                    if (signatureErr) {
                      return res.status(500).json({ error: signatureErr.message })
                    }

                    computeViolationHash(session_id, (hashErr, hash) => {
                      if (hashErr) return res.status(500).json({ error: hashErr.message })

                      db.run(
                        `
                          UPDATE duty_sessions
                          SET status='signed',
                              signed_at=?,
                              signed_snapshot_hash=?
                          WHERE id=?
                        `,
                        [time.now(), hash, session_id],
                        (updateErr) => {
                          if (updateErr) {
                            return res.status(500).json({ error: updateErr.message })
                          }

                          db.run(
                            `
                              INSERT INTO duty_revision_logs
                              (session_id,action,created_at)
                              VALUES(?,?,?)
                            `,
                            [session_id, "sign", time.now()],
                            () => {
                              res.json({ success: true, photo_path: photoPath })
                            },
                          )
                        },
                      )
                    })
                  },
                )
              }

              db.run(
                `
                  UPDATE accounts
                  SET pin_failed_attempts = 0,
                      pin_locked_until = 0
                  WHERE class_id = ?
                `,
                [accountClassId],
                (resetErr) => {
                  if (resetErr) {
                    return res.status(500).json({ error: resetErr.message })
                  }

                  proceedWithSignature()
                },
              )
            },
          )
        })
      },
    )
  },
)

router.get(
  "/admin/week/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.get(`SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`, [weekId], (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(404).json({ error: "Week not found" })

      aggregateSessions("WHERE s.week_id=?", [weekId], (sessionErr, sessions) => {
        if (sessionErr) return res.status(500).json({ error: sessionErr.message })
        withBaseScore((baseErr, baseScore) => {
          if (baseErr) return res.status(500).json({ error: baseErr.message })
          res.json({ week, sessions: sessions || [], base_points: baseScore })
        })
      })
    })
  },
)

router.get(
  "/admin/session/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const sessionId = Number(req.params.id)
    if (!sessionId) return res.status(400).json({ error: "Invalid session" })

    db.get(
      `
        SELECT
          s.*,
          w.week_number,
          w.start_date,
          w.end_date,
          COALESCE(b.points, 0) as bonus_points,
          b.min_score as bonus_min_score,
          b.source as bonus_source,
          ds.photo_path as signature_photo_path,
          ds.signed_at as signature_signed_at
        FROM duty_sessions s
        JOIN schedule_weeks w
          ON w.id = s.week_id
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        ${latestSignatureJoin("ds")}
        WHERE s.id=?
        LIMIT 1
      `,
      [sessionId],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        db.all(
          `
            SELECT v.id, v.rule_id, v.quantity, v.note,
                   r.category, r.name, r.score_delta
            FROM duty_violations v
            LEFT JOIN rules r
              ON r.id = v.rule_id
            WHERE v.session_id=?
            ORDER BY v.id DESC
          `,
          [sessionId],
          (violationErr, violations) => {
            if (violationErr) return res.status(500).json({ error: violationErr.message })

            db.all(
              `
                SELECT id, action, created_at
                FROM duty_revision_logs
                WHERE session_id=?
                ORDER BY id DESC
              `,
              [sessionId],
              (revisionErr, revisions) => {
                if (revisionErr) return res.status(500).json({ error: revisionErr.message })

                db.all(
                  `
                    SELECT id, photo_path, signed_at
                    FROM duty_signatures
                    WHERE session_id=?
                    ORDER BY id DESC
                  `,
                  [sessionId],
                  (signatureErr, signatures) => {
                    if (signatureErr) return res.status(500).json({ error: signatureErr.message })
                    res.json({
                      session,
                      week: {
                        id: session.week_id,
                        week_number: session.week_number,
                        start_date: session.start_date,
                        end_date: session.end_date,
                      },
                      violations: violations || [],
                      revisions: revisions || [],
                      signatures: signatures || [],
                    })
                  },
                )
              },
            )
          },
        )
      },
    )
  },
)

router.get(
  "/admin/week/:id/stats",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    weekSessionCounts(weekId, (err, stats) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(stats)
    })
  },
)

router.get(
  "/admin/week/:id/summary",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.get(`SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`, [weekId], (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(404).json({ error: "Week not found" })

      isWeekClosed(weekId, (closedErr, closed, closedAt) => {
        if (closedErr) return res.status(500).json({ error: closedErr.message })
        if (closed) {
          return db.all(
            `
              SELECT class_name, score, updated_at
              FROM weekly_scores
              WHERE week_id=?
              ORDER BY score DESC, class_name ASC
            `,
            [weekId],
            (scoreErr, scores) => {
              if (scoreErr) return res.status(500).json({ error: scoreErr.message })
              res.json({ week, closed_at: closedAt || null, scores: scores || [] })
            },
          )
        }

        computeWeekScores(weekId, (scoreErr, scores) => {
          if (scoreErr) return res.status(500).json({ error: scoreErr.message })
          res.json({ week, closed_at: null, scores: scores || [] })
        })
      })
    })
  },
)

router.post(
  "/admin/week/:id/close",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    isWeekClosed(weekId, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Week already closed" })

      ensureGradebookUploadsForWeek(weekId, (gradebookErr) => {
        if (gradebookErr) {
          return res.status(gradebookErr.status || 500).json({ error: gradebookErr.message })
        }

        computeWeekScores(weekId, (scoreErr, scores) => {
          if (scoreErr) return res.status(500).json({ error: scoreErr.message })
          writeWeeklyScores(weekId, scores || [], (writeErr) => {
            if (writeErr) return res.status(500).json({ error: writeErr.message })
            const closedAt = time.now()
            db.run(
              `
                INSERT INTO week_closings (week_id, closed_at)
                VALUES(?,?)
                ON CONFLICT(week_id)
                DO UPDATE SET closed_at=excluded.closed_at
              `,
              [weekId, closedAt],
              (closeErr) => {
                if (closeErr) return res.status(500).json({ error: closeErr.message })
                res.json({ success: true, week_id: weekId, closed_at: closedAt })
              },
            )
          })
        })
      })
    })
  },
)

router.post(
  "/admin/week/:id/reopen",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.run(
      `UPDATE week_closings SET closed_at=NULL WHERE week_id=?`,
      [weekId],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true, reopened: this.changes })
      },
    )
  },
)

router.get(
  "/admin/week/:id/class/:className/breakdown",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.id)
    const className = String(req.params.className || "").trim().toUpperCase()
    if (!weekId || !className) return res.status(400).json({ error: "Invalid request" })

    weekBreakdowns(weekId, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message })
      const rankedRows = annotateNotesAndRanks(
        (rows || []).sort((a, b) => Number(b.total_score || 0) - Number(a.total_score || 0)),
      )
      const row = rankedRows.find((item) => String(item.class_name || "").toUpperCase() === className)
      if (!row) return res.status(404).json({ error: "Class not found" })

      db.all(
        `
          SELECT
            s.id,
            s.date,
            s.status,
            COALESCE(b.points, 0) as bonus_points
          FROM duty_sessions s
          LEFT JOIN daily_bonus b
            ON b.week_id = s.week_id
           AND b.date = s.date
           AND b.class_name = s.duty_class
          WHERE s.week_id=?
            AND s.duty_class=?
          ORDER BY s.date ASC, s.id ASC
        `,
        [weekId, className],
        (dayErr, days) => {
          if (dayErr) return res.status(500).json({ error: dayErr.message })
          const sessionIds = (days || []).map((day) => Number(day.id)).filter(Boolean)
          if (!sessionIds.length) {
            return res.json({ week_id: weekId, class_name: className, breakdown: row, days: [] })
          }

          const placeholders = sessionIds.map(() => "?").join(",")
          db.all(
            `
              SELECT v.session_id, v.id, v.rule_id, v.quantity, v.note,
                     r.category, r.name, r.score_delta
              FROM duty_violations v
              LEFT JOIN rules r
                ON r.id = v.rule_id
              WHERE v.session_id IN (${placeholders})
              ORDER BY v.id ASC
            `,
            sessionIds,
            (violationErr, violations) => {
              if (violationErr) return res.status(500).json({ error: violationErr.message })
              const bySession = new Map()
              for (const violation of violations || []) {
                const key = Number(violation.session_id)
                if (!bySession.has(key)) bySession.set(key, [])
                bySession.get(key).push(violation)
              }
              res.json({
                week_id: weekId,
                class_name: className,
                breakdown: row,
                days: (days || []).map((day) => ({
                  ...day,
                  violations: bySession.get(Number(day.id)) || [],
                })),
              })
            },
          )
        },
      )
    })
  },
)

router.get(
  "/admin/week/:id/export",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const weekId = Number(req.params.id)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    try {
      const week = await db.get(`SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`, [weekId])
      if (!week) return res.status(404).json({ error: "Week not found" })

      const scores = await db.all(
        `
          SELECT class_name, score, updated_at
          FROM weekly_scores
          WHERE week_id=?
          ORDER BY score DESC, class_name ASC
        `,
        [weekId],
      )
      const rows = scores?.length
        ? scores
        : await new Promise((resolve, reject) => {
          computeWeekScores(weekId, (err, computedRows) => (err ? reject(err) : resolve(computedRows || [])))
        })

      const workbook = new ExcelJS.Workbook()
      const ws = workbook.addWorksheet("Weekly Scores")
      ws.columns = [
        { header: "Lớp", key: "class_name", width: 18 },
        { header: "Tổng điểm", key: "score", width: 14 },
        { header: "Cập nhật", key: "updated_at", width: 28 },
      ]
      for (const row of rows || []) {
        ws.addRow({
          class_name: row.class_name,
          score: Number(row.score || 0),
          updated_at: row.updated_at || "",
        })
      }
      ws.getRow(1).font = { bold: true }

      const buffer = await workbook.xlsx.writeBuffer()
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      res.setHeader("Content-Disposition", `attachment; filename="ket_qua_thi_dua_tuan_${week.week_number || weekId}.xlsx"`)
      res.send(Buffer.from(buffer))
    } catch (err) {
      res.status(500).json({ error: err?.message || "Cannot export week scores" })
    }
  },
)

/*
ADMIN: sign a duty session (no PIN), re-auth by admin password
body: { admin_password }
*/
router.post(
  "/admin/session/:id/sign",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const sessionId = Number(req.params.id)
    const adminPassword = String(req.body?.admin_password || "")
    const username = req.session.user?.username

    if (!sessionId) return res.status(400).json({ error: "Invalid session" })
    if (!adminPassword) return res.status(400).json({ error: "Missing password" })
    if (!username) return res.status(401).json({ error: "Not authenticated" })

    db.get(
      `SELECT password FROM admins WHERE username=? LIMIT 1`,
      [username],
      (err, admin) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!admin) return res.status(401).json({ error: "Not authenticated" })

        bcrypt.compare(adminPassword, String(admin.password || ""), (err2, ok) => {
          if (err2) return res.status(500).json({ error: err2.message })
          if (!ok) return res.status(403).json({ error: "Invalid password" })

          db.get(
            `SELECT id, week_id, status FROM duty_sessions WHERE id=? LIMIT 1`,
            [sessionId],
            (err3, session) => {
              if (err3) return res.status(500).json({ error: err3.message })
              if (!session) return res.status(404).json({ error: "Session not found" })

              isWeekClosed(session.week_id, (err4, closed) => {
                if (err4) return res.status(500).json({ error: err4.message })
                if (closed) return res.status(403).json({ error: "Week closed" })

                const now = time.now()
                db.serialize(() => {
                  db.run(
                    `
                      INSERT INTO duty_signatures
                      (session_id,photo_path,signed_at)
                      VALUES(?,?,?)
                    `,
                    [sessionId, null, now],
                    (err5) => {
                      if (err5) return res.status(500).json({ error: err5.message })

                      computeViolationHash(sessionId, (err6, hash) => {
                        if (err6) return res.status(500).json({ error: err6.message })

                        db.run(
                          `
                            UPDATE duty_sessions
                            SET status='signed',
                                signed_at=?,
                                signed_snapshot_hash=?
                            WHERE id=?
                          `,
                          [now, hash, sessionId],
                          (err7) => {
                            if (err7) return res.status(500).json({ error: err7.message })

                            db.run(
                              `
                                INSERT INTO duty_revision_logs
                                (session_id,action,created_at)
                                VALUES(?,?,?)
                              `,
                              [sessionId, "sign:admin", now],
                              () => {
                                res.json({ success: true })
                              },
                            )
                          },
                        )
                      })
                    },
                  )
                })
              })
            })
        })
      })
  },
)
/*
ADMIN: month preview/adjust/close/reopen/summary/breakdown/export
*/
router.get(
  "/admin/month/list",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.all(
      `
        SELECT
          m.id,
          m.semester_id,
          m.month_number,
          m.month_key,
          m.name,
          s.name as semester_name,
          s.semester_number,
          y.name as school_year_name,
          ms.closed_at,
          ms.updated_at,
          COALESCE(
            json_agg(w.id ORDER BY w.week_number ASC, w.start_date ASC, w.id ASC)
              FILTER (WHERE w.id IS NOT NULL),
            '[]'
          )::text as week_ids
        FROM months m
        JOIN semesters s
          ON s.id = m.semester_id
        JOIN school_years y
          ON y.id = s.school_year_id
        LEFT JOIN schedule_weeks w
          ON w.month_id = m.id
        LEFT JOIN month_summaries ms
          ON ms.month_key = m.month_key
        GROUP BY
          m.id,
          m.semester_id,
          m.month_number,
          m.month_key,
          m.name,
          s.name,
          s.semester_number,
          y.name,
          ms.closed_at,
          ms.updated_at
        ORDER BY ${monthOrderSql("m")} ASC, m.id ASC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({
          months: (rows || []).map((row) => ({
            ...row,
            week_ids: parseJsonList(row.week_ids),
            closed_at: row.closed_at || null,
          })),
        })
      },
    )
  },
)

router.post(
  "/admin/month/preview",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed, closedAt) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) {
        return loadPeriodScores("month_scores", "month_key", monthKey, (scoreErr, scores) => {
          if (scoreErr) return res.status(500).json({ error: scoreErr.message })
          res.json({
            month_key: monthKey,
            week_ids: [],
            closed_at: closedAt,
            scores_by_grade: periodToRowsByGrade(scores || []),
          })
        })
      }

      loadWeekIdsForMonthKey(monthKey, (weekErr, weekIds) => {
        if (weekErr) return res.status(500).json({ error: weekErr.message })
        if (!weekIds.length) return res.status(400).json({ error: "No weeks in month" })

        const now = time.now()
        upsertPeriodSummary("month_summaries", "month_key", monthKey, weekIds, null, (summaryErr) => {
          if (summaryErr) return res.status(500).json({ error: summaryErr.message })

          loadAdjustments("month_adjustments", "month_key", monthKey, (adjErr, adjMap) => {
            if (adjErr) return res.status(500).json({ error: adjErr.message })
            computePeriodFromWeeks(weekIds, adjMap, (computeErr, rawRows) => {
              if (computeErr) return res.status(500).json({ error: computeErr.message })
              const rows = toMonthRows(rawRows)
              res.json({
                month_key: monthKey,
                week_ids: weekIds,
                closed_at: null,
                updated_at: now,
                scores_by_grade: periodToRowsByGrade(rows),
              })
            })
          })
        })
      })
    })
  },
)

router.post(
  "/admin/month/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    const className = String(req.body.class_name || "").trim().toUpperCase()
    const plusPoints = Number(req.body.plus_points || 0)
    const minusPoints = Number(req.body.minus_points || 0)
    const reason = String(req.body.reason || "").trim()
    if (!monthKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Month closed" })
      upsertAdjustment(
        "month_adjustments",
        "month_key",
        monthKey,
        className,
        Number.isFinite(plusPoints) ? plusPoints : 0,
        Number.isFinite(minusPoints) ? minusPoints : 0,
        reason,
        (adjustErr) => {
          if (adjustErr) return res.status(500).json({ error: adjustErr.message })
          res.json({ success: true })
        },
      )
    })
  },
)

router.delete(
  "/admin/month/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key || req.query.month_key)
    const className = String(req.body.class_name || req.query.class_name || "").trim().toUpperCase()
    if (!monthKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Month closed" })
      deleteAdjustment("month_adjustments", "month_key", monthKey, className, (deleteErr, deleted) => {
        if (deleteErr) return res.status(500).json({ error: deleteErr.message })
        res.json({ success: true, deleted })
      })
    })
  },
)

router.post(
  "/admin/month/adjustment/upload",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    const fileData = String(req.body.file_data || "")
    const fileName = String(req.body.file_name || "month_adjustments.xlsx")
    if (!monthKey || !fileData) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Month closed" })

      let workbook
      try {
        workbook = xlsx.read(Buffer.from(fileData, "base64"), { type: "buffer" })
      } catch (readErr) {
        return res.status(400).json({ error: readErr?.message || "Cannot read Excel file" })
      }

      const firstSheetName = workbook.SheetNames?.[0]
      if (!firstSheetName) return res.status(400).json({ error: "Excel has no sheet" })
      const ws = workbook.Sheets[firstSheetName]
      if (!ws || !ws["!ref"]) return res.status(400).json({ error: "Excel sheet is empty" })

      const range = xlsx.utils.decode_range(ws["!ref"])
      const rows = []
      for (let rowIndex = 2; rowIndex <= range.e.r; rowIndex += 1) {
        const classCell = ws[xlsx.utils.encode_cell({ c: 0, r: rowIndex })]
        const deltaCell = ws[xlsx.utils.encode_cell({ c: 1, r: rowIndex })]
        const reasonCell = ws[xlsx.utils.encode_cell({ c: 2, r: rowIndex })]
        const className = String(classCell?.v || "").trim().toUpperCase()
        const delta = Number(deltaCell?.v || 0)
        if (!className || !Number.isFinite(delta)) continue
        rows.push({
          class_name: className,
          plus_points: delta > 0 ? delta : 0,
          minus_points: delta < 0 ? -delta : 0,
          reason: String(reasonCell?.v || `Nhập từ Excel: ${fileName}`).trim(),
        })
      }

      if (!rows.length) {
        return res.status(400).json({ error: "No valid data rows from row 3 (A=class, B=points)" })
      }

      ; (async () => {
        try {
          const now = time.now()
          await db.withTransaction(async () => {
            for (const row of rows) {
              await db.run(
                `
                  INSERT INTO month_adjustments
                  (month_key, class_name, plus_points, minus_points, reason, created_at, updated_at)
                  VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(month_key, class_name)
                  DO UPDATE SET
                    plus_points=excluded.plus_points,
                    minus_points=excluded.minus_points,
                    reason=excluded.reason,
                    updated_at=excluded.updated_at
                `,
                [
                  monthKey,
                  row.class_name,
                  row.plus_points,
                  row.minus_points,
                  row.reason,
                  now,
                  now,
                ],
              )
            }
          })
          res.json({ success: true, imported: rows.length })
        } catch (importErr) {
          res.status(500).json({ error: importErr.message })
        }
      })()
    })
  },
)

router.get(
  "/admin/month/adjustment/template",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const workbook = new ExcelJS.Workbook()
      const ws = workbook.addWorksheet("Month Adjustments")
      ws.columns = [
        { header: "Lớp", key: "class_name", width: 18 },
        { header: "Điểm cộng/trừ", key: "delta", width: 18 },
        { header: "Lý do", key: "reason", width: 36 },
      ]
      ws.addRow({ class_name: "10A1", delta: 10, reason: "Điểm cộng phong trào tháng" })
      ws.addRow({ class_name: "11A1", delta: -5, reason: "Điểm trừ vi phạm cấp tháng" })
      ws.getRow(1).font = { bold: true }

      const buffer = await workbook.xlsx.writeBuffer()
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      res.setHeader("Content-Disposition", 'attachment; filename="template_month_adjustments.xlsx"')
      res.send(Buffer.from(buffer))
    } catch (err) {
      res.status(500).json({ error: err?.message || "Cannot create template" })
    }
  },
)

router.post(
  "/admin/month/close",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    const weekIds = parseWeekIds(req.body.week_ids)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Month already closed" })

      const ensureWeeks = (ids) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })
        ensureAllWeeksClosed(ids, (lockErr) => {
          if (lockErr) {
            const message =
              lockErr.message && String(lockErr.message).includes("Con tuan chua khoa")
                ? "Tất cả các tuần trong tháng phải được tổng kết trước."
                : lockErr.message
            return res.status(lockErr.status || 500).json({ error: message })
          }
          loadAdjustments("month_adjustments", "month_key", monthKey, (err2, adjMap) => {
            if (err2) return res.status(500).json({ error: err2.message })
            computePeriodFromWeeks(ids, adjMap, (err3, rawRows) => {
              if (err3) return res.status(500).json({ error: err3.message })
              const rows = toMonthRows(rawRows)
              const rowsByGrade = periodToRowsByGrade(rows)
              writePeriodScores("month_scores", "month_key", monthKey, rowsByGrade, (err4) => {
                if (err4) return res.status(500).json({ error: err4.message })
                const closedAt = time.now()
                upsertPeriodSummary(
                  "month_summaries",
                  "month_key",
                  monthKey,
                  ids,
                  closedAt,
                  (err5) => {
                    if (err5) return res.status(500).json({ error: err5.message })
                    res.json({
                      success: true,
                      month_key: monthKey,
                      closed_at: closedAt,
                      week_ids: ids,
                    })
                  },
                )
              })
            })
          })
        })
      }

      if (weekIds.length) return ensureWeeks(weekIds)
      loadPeriodSummary("month_summaries", "month_key", monthKey, (err2, meta) => {
        if (err2) return res.status(500).json({ error: err2.message })
        return ensureWeeks(meta?.week_ids || [])
      })
    })
  },
)

router.post(
  "/admin/month/reopen",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })
    db.run(
      `UPDATE month_summaries SET closed_at=NULL, updated_at=? WHERE month_key=?`,
      [time.now(), monthKey],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true, reopened: this.changes })
      },
    )
  },
)

router.get(
  "/admin/month/:monthKey/summary",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.params.monthKey)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })

    loadPeriodSummary("month_summaries", "month_key", monthKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })

      isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed, closedAt) => {
        if (err) return res.status(500).json({ error: err.message })
        if (closed) {
          loadPeriodScores("month_scores", "month_key", monthKey, (err, scores) => {
            if (err) return res.status(500).json({ error: err.message })
            res.json({ month_key: monthKey, week_ids: meta?.week_ids || [], closed_at: closedAt, scores })
          })
          return
        }
        res.json({ month_key: monthKey, week_ids: meta?.week_ids || [], closed_at: closedAt, scores: [] })
      })
    })
  },
)

router.get(
  "/admin/month/:monthKey/class/:className/breakdown",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.params.monthKey)
    const className = String(req.params.className || "").trim().toUpperCase()
    if (!monthKey || !className) return res.status(400).json({ error: "Invalid request" })

    loadPeriodSummary("month_summaries", "month_key", monthKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })

      loadAdjustments("month_adjustments", "month_key", monthKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rawRows) => {
          if (err) return res.status(500).json({ error: err.message })
          const rows = toMonthRows(rawRows)
          const row = (rows || []).find((r) => String(r.class_name).toUpperCase() === className)
          if (!row) return res.status(404).json({ error: "Class not found" })

          const placeholders = weekIds.map(() => "?").join(",")
          db.all(
            `
              SELECT id, week_number
              FROM schedule_weeks
              WHERE id IN (${placeholders})
            `,
            weekIds,
            (err2, weekMetaRows) => {
              if (err2) return res.status(500).json({ error: err2.message })

              const weekMetaById = new Map()
                ; (weekMetaRows || []).forEach((w) => {
                  weekMetaById.set(Number(w.id), Number(w.week_number))
                })

              const details = []
              const sortedWeekIds = [...weekIds].sort((a, b) => {
                const wa = weekMetaById.get(Number(a)) || 0
                const wb = weekMetaById.get(Number(b)) || 0
                return wa - wb
              })

              const next = (idx) => {
                if (idx >= sortedWeekIds.length) {
                  return res.json({
                    month_key: monthKey,
                    week_ids: weekIds,
                    breakdown: row,
                    week_details: details,
                  })
                }

                const wid = Number(sortedWeekIds[idx])
                weekBreakdowns(wid, (err3, weekRows) => {
                  if (err3) return res.status(500).json({ error: err3.message })
                  const classWeekRow = (weekRows || []).find(
                    (r) => String(r.class_name).toUpperCase() === className,
                  )
                  details.push({
                    week_id: wid,
                    week_number: weekMetaById.get(wid) || null,
                    score: Number(classWeekRow?.total_score || 0),
                  })
                  next(idx + 1)
                })
              }

              next(0)
            },
          )
        })
      })
    })
  },
)

router.get(
  "/admin/month/:monthKey/export",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.params.monthKey)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })

    loadPeriodSummary("month_summaries", "month_key", monthKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })

      loadAdjustments("month_adjustments", "month_key", monthKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rawRows) => {
          if (err) return res.status(500).json({ error: err.message })
          const rows = toMonthRows(rawRows)
          const byGrade = periodToRowsByGrade(rows)
          exportExcelWorkbookForMonth(res, {
            fileName: `ket_qua_thi_dua_thang_${monthKey.replace(/[\\/]/g, "-")}.xlsx`,
            periodTitleByGrade: (g) => `KẾT QUẢ THI ĐUA CỜ ĐỎ KHỐI ${g}`,
            periodLine2: monthPeriodLabel(monthKey),
            rowsByGrade: byGrade,
          })
        })
      })
    })
  },
)

/*
ADMIN: semester preview/adjust/close/reopen/summary/breakdown/export
semester_key format: 2025-2026-HK1 or 2025-2026-HK2
*/
router.get(
  "/admin/semester/list",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.all(
      `
        SELECT
          s.id,
          s.school_year_id,
          y.name as school_year_name,
          s.semester_number,
          s.name,
          (y.name || '-HK' || s.semester_number) as semester_key,
          ss.closed_at,
          ss.updated_at,
          COALESCE(
            json_agg(DISTINCT m.month_key) FILTER (WHERE m.month_key IS NOT NULL),
            '[]'
          )::text as month_keys,
          COALESCE(
            json_agg(w.id ORDER BY w.week_number ASC, w.start_date ASC, w.id ASC)
              FILTER (WHERE w.id IS NOT NULL),
            '[]'
          )::text as week_ids
        FROM semesters s
        JOIN school_years y
          ON y.id = s.school_year_id
        LEFT JOIN semester_summaries ss
          ON ss.semester_key = (y.name || '-HK' || s.semester_number)
        LEFT JOIN months m
          ON m.semester_id = s.id
        LEFT JOIN schedule_weeks w
          ON w.month_id = m.id
        GROUP BY
          s.id,
          s.school_year_id,
          y.name,
          s.semester_number,
          s.name,
          ss.closed_at,
          ss.updated_at
        ORDER BY y.name DESC, s.semester_number ASC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        const out = (rows || []).map((r) => ({
          id: r.id,
          school_year_id: r.school_year_id,
          school_year_name: r.school_year_name,
          semester_number: r.semester_number,
          name: r.name,
          semester_key: r.semester_key,
          week_ids: parseJsonList(r.week_ids),
          month_keys: parseJsonList(r.month_keys),
          closed_at: r.closed_at || null,
          updated_at: r.updated_at || null,
        }))
        res.json({ semesters: out })
      },
    )
  },
)

router.post(
  "/admin/semester/save",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key)
    const monthKeys = parseJsonList(req.body.month_keys)
    if (!semesterKey) return res.status(400).json({ error: "Invalid semester_key" })
    if (!monthKeys.length) return res.status(400).json({ error: "Missing month_keys" })

    isPeriodClosed("semester_summaries", "semester_key", semesterKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Semester closed" })

      loadWeekIdsForMonths(monthKeys, (err2, weekIds) => {
        if (err2) return res.status(500).json({ error: err2.message })
        if (!weekIds.length) return res.status(400).json({ error: "No weeks from months" })
        const now = time.now()
        db.run(
          `
            INSERT INTO semester_summaries
            (semester_key, week_ids, month_keys, closed_at, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(semester_key)
            DO UPDATE SET
              week_ids=excluded.week_ids,
              month_keys=excluded.month_keys,
              closed_at=excluded.closed_at,
              updated_at=excluded.updated_at
          `,
          [semesterKey, JSON.stringify(weekIds), JSON.stringify(monthKeys), null, now, now],
          (err3) => {
            if (err3) return res.status(500).json({ error: err3.message })
            res.json({ success: true, semester_key: semesterKey, month_keys: monthKeys, week_ids: weekIds })
          },
        )
      })
    })
  },
)

router.post(
  "/admin/semester/preview",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key)
    if (!semesterKey) return res.status(400).json({ error: "Invalid semester_key" })

    isPeriodClosed("semester_summaries", "semester_key", semesterKey, (err, closed, closedAt) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) {
        return loadSemesterSummary(semesterKey, (err2, meta) => {
          if (err2) return res.status(500).json({ error: err2.message })
          loadPeriodScores("semester_scores", "semester_key", semesterKey, (err3, scores) => {
            if (err3) return res.status(500).json({ error: err3.message })
            const byGrade = { 10: [], 11: [], 12: [] }
              ; (scores || []).forEach((r) => {
                const g = Number(r.grade)
                if (g === 10 || g === 11 || g === 12) byGrade[g].push(r)
              })
            res.json({
              semester_key: semesterKey,
              week_ids: meta?.week_ids || [],
              closed_at: closedAt,
              scores_by_grade: byGrade,
            })
          })
        })
      }

      const ensureWeeks = (ids, monthKeys) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })
        const now = time.now()
        db.run(
          `
            INSERT INTO semester_summaries
            (semester_key, week_ids, month_keys, closed_at, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(semester_key)
            DO UPDATE SET
              week_ids=excluded.week_ids,
              month_keys=excluded.month_keys,
              closed_at=excluded.closed_at,
              updated_at=excluded.updated_at
          `,
          [semesterKey, JSON.stringify(ids), JSON.stringify(monthKeys || []), null, now, now],
          (err2) => {
            if (err2) return res.status(500).json({ error: err2.message })
            loadAdjustments("semester_adjustments", "semester_key", semesterKey, (err3, adjMap) => {
              if (err3) return res.status(500).json({ error: err3.message })
              computePeriodFromWeeks(ids, adjMap, (err4, rows) => {
                if (err4) return res.status(500).json({ error: err4.message })
                res.json({
                  semester_key: semesterKey,
                  week_ids: ids,
                  closed_at: null,
                  scores_by_grade: periodToRowsByGrade(rows),
                })
              })
            })
          },
        )
      }

      const monthKeys = parseJsonList(req.body.month_keys)
      if (monthKeys.length) {
        return loadWeekIdsForMonths(monthKeys, (err2, ids) => {
          if (err2) return res.status(500).json({ error: err2.message })
          return ensureWeeks(ids, monthKeys)
        })
      }

      loadSemesterSummary(semesterKey, (err2, meta) => {
        if (err2) return res.status(500).json({ error: err2.message })
        const savedMonthKeys = meta?.month_keys || []
        return ensureWeeks(meta?.week_ids || [], savedMonthKeys)
      })
    })
  },
)

router.post(
  "/admin/semester/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key)
    const className = String(req.body.class_name || "").trim().toUpperCase()
    const plusPoints = Number(req.body.plus_points || 0)
    const minusPoints = Number(req.body.minus_points || 0)
    const reason = String(req.body.reason || "").trim()
    if (!semesterKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("semester_summaries", "semester_key", semesterKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Semester closed" })
      upsertAdjustment(
        "semester_adjustments",
        "semester_key",
        semesterKey,
        className,
        plusPoints,
        minusPoints,
        reason,
        (err) => {
          if (err) return res.status(500).json({ error: err.message })
          res.json({ success: true })
        },
      )
    })
  },
)

router.delete(
  "/admin/semester/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key || req.query.semester_key)
    const className = String(req.body.class_name || req.query.class_name || "").trim().toUpperCase()
    if (!semesterKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("semester_summaries", "semester_key", semesterKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Semester closed" })
      deleteAdjustment("semester_adjustments", "semester_key", semesterKey, className, (deleteErr, deleted) => {
        if (deleteErr) return res.status(500).json({ error: deleteErr.message })
        res.json({ success: true, deleted })
      })
    })
  },
)

router.post(
  "/admin/semester/close",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key)
    if (!semesterKey) return res.status(400).json({ error: "Invalid semester_key" })

    isPeriodClosed("semester_summaries", "semester_key", semesterKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Semester already closed" })

      const ensureWeeks = (ids, monthKeys) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })
        ensureAllMonthsClosed(monthKeys || [], (monthLockErr) => {
          if (monthLockErr) {
            const message =
              monthLockErr.message && String(monthLockErr.message).includes("Con thang chua khoa")
                ? "Tất cả các tháng trong học kỳ phải được tổng kết trước."
                : monthLockErr.message
            return res.status(monthLockErr.status || 500).json({ error: message })
          }
          ensureAllWeeksClosed(ids, (weekLockErr) => {
            if (weekLockErr) {
              const message =
                weekLockErr.message && String(weekLockErr.message).includes("Con tuan chua khoa")
                  ? "Tất cả các tuần trong học kỳ phải được tổng kết trước."
                  : weekLockErr.message
              return res.status(weekLockErr.status || 500).json({ error: message })
            }
            loadAdjustments("semester_adjustments", "semester_key", semesterKey, (err2, adjMap) => {
              if (err2) return res.status(500).json({ error: err2.message })
              computePeriodFromWeeks(ids, adjMap, (err3, rows) => {
                if (err3) return res.status(500).json({ error: err3.message })
                const rowsByGrade = periodToRowsByGrade(rows)
                writePeriodScores("semester_scores", "semester_key", semesterKey, rowsByGrade, (err4) => {
                  if (err4) return res.status(500).json({ error: err4.message })
                  const closedAt = time.now()
                  db.run(
                    `
                  INSERT INTO semester_summaries
                  (semester_key, week_ids, month_keys, closed_at, created_at, updated_at)
                  VALUES(?,?,?,?,?,?)
                  ON CONFLICT(semester_key)
                  DO UPDATE SET
                    week_ids=excluded.week_ids,
                    month_keys=excluded.month_keys,
                    closed_at=excluded.closed_at,
                    updated_at=excluded.updated_at
                `,
                    [semesterKey, JSON.stringify(ids), JSON.stringify(monthKeys || []), closedAt, closedAt, closedAt],
                    (err5) => {
                      if (err5) return res.status(500).json({ error: err5.message })
                      res.json({
                        success: true,
                        semester_key: semesterKey,
                        closed_at: closedAt,
                        week_ids: ids,
                      })
                    },
                  )
                })
              })
            })
          })
        })
      }

      const monthKeys = parseJsonList(req.body.month_keys)
      if (monthKeys.length) {
        return loadWeekIdsForMonths(monthKeys, (err2, ids) => {
          if (err2) return res.status(500).json({ error: err2.message })
          return ensureWeeks(ids, monthKeys)
        })
      }

      loadSemesterSummary(semesterKey, (err2, meta) => {
        if (err2) return res.status(500).json({ error: err2.message })
        const savedMonthKeys = meta?.month_keys || []
        return ensureWeeks(meta?.week_ids || [], savedMonthKeys)
      })
    })
  },
)

router.post(
  "/admin/semester/reopen",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.body.semester_key)
    if (!semesterKey) return res.status(400).json({ error: "Invalid semester_key" })
    db.run(
      `UPDATE semester_summaries SET closed_at=NULL, updated_at=? WHERE semester_key=?`,
      [time.now(), semesterKey],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true, reopened: this.changes })
      },
    )
  },
)

router.get(
  "/admin/semester/:semesterKey/class/:className/breakdown",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.params.semesterKey)
    const className = String(req.params.className || "").trim().toUpperCase()
    if (!semesterKey || !className) return res.status(400).json({ error: "Invalid request" })

    loadPeriodSummary("semester_summaries", "semester_key", semesterKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })
      loadAdjustments("semester_adjustments", "semester_key", semesterKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          const row = (rows || []).find((r) => String(r.class_name).toUpperCase() === className)
          if (!row) return res.status(404).json({ error: "Class not found" })
          res.json({ semester_key: semesterKey, week_ids: weekIds, breakdown: row })
        })
      })
    })
  },
)

router.get(
  "/admin/semester/:semesterKey/export",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const semesterKey = normalizeSemesterKey(req.params.semesterKey)
    if (!semesterKey) return res.status(400).json({ error: "Invalid semester_key" })

    loadPeriodSummary("semester_summaries", "semester_key", semesterKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })

      loadAdjustments("semester_adjustments", "semester_key", semesterKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          const byGrade = periodToRowsByGrade(rows)
          const hkNumber = semesterKey.match(/HK([1-9])$/i)?.[1] || ""
          const hk = romanNumeral(Number(hkNumber))
          exportExcelWorkbookForPeriod(res, {
            fileName: `ket_qua_thi_dua_${semesterKey}.xlsx`,
            periodTitleByGrade: (g) => `KẾT QUẢ THI ĐUA CỜ ĐỎ KHỐI ${g}`,
            periodLine2: `Học kỳ ${hk} (${semesterKey.slice(0, 9)})`,
            rowsByGrade: byGrade,
          })
        })
      })
    })
  },
)

/*
ADMIN: year preview/adjust/close/reopen/breakdown/export
year_key format: 2025-2026
*/
router.get(
  "/admin/year/list",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.all(
      `
        SELECT
          y.id,
          y.name as year_key,
          y.start_year,
          y.end_year,
          ys.closed_at,
          ys.updated_at,
          COALESCE(
            json_agg(DISTINCT (y.name || '-HK' || s.semester_number))
              FILTER (WHERE s.id IS NOT NULL),
            '[]'
          )::text as semester_keys,
          COALESCE(
            json_agg(w.id ORDER BY s.semester_number ASC, ${monthOrderSql("m")} ASC, w.week_number ASC, w.id ASC)
              FILTER (WHERE w.id IS NOT NULL),
            '[]'
          )::text as week_ids
        FROM school_years y
        LEFT JOIN year_summaries ys
          ON ys.year_key = y.name
        LEFT JOIN semesters s
          ON s.school_year_id = y.id
        LEFT JOIN months m
          ON m.semester_id = s.id
        LEFT JOIN schedule_weeks w
          ON w.month_id = m.id
        GROUP BY y.id, y.name, y.start_year, y.end_year, ys.closed_at, ys.updated_at
        ORDER BY y.start_year DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        const out = (rows || []).map((r) => ({
          id: r.id,
          year_key: r.year_key,
          start_year: r.start_year,
          end_year: r.end_year,
          week_ids: parseJsonList(r.week_ids),
          semester_keys: parseJsonList(r.semester_keys),
          closed_at: r.closed_at || null,
          updated_at: r.updated_at || null,
        }))
        res.json({ years: out })
      },
    )
  },
)

router.post(
  "/admin/year/save",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key)
    const semesterKeys = parseJsonList(req.body.semester_keys)
    if (!yearKey) return res.status(400).json({ error: "Invalid year_key" })
    if (!semesterKeys.length) return res.status(400).json({ error: "Missing semester_keys" })

    isPeriodClosed("year_summaries", "year_key", yearKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Year closed" })

      loadWeekIdsForSemesters(semesterKeys, (err2, weekIds) => {
        if (err2) return res.status(500).json({ error: err2.message })
        if (!weekIds.length) return res.status(400).json({ error: "No weeks from semesters" })
        const now = time.now()
        db.run(
          `
            INSERT INTO year_summaries
            (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(year_key)
            DO UPDATE SET
              week_ids=excluded.week_ids,
              semester_keys=excluded.semester_keys,
              closed_at=excluded.closed_at,
              updated_at=excluded.updated_at
          `,
          [yearKey, JSON.stringify(weekIds), JSON.stringify(semesterKeys), null, now, now],
          (err3) => {
            if (err3) return res.status(500).json({ error: err3.message })
            res.json({ success: true, year_key: yearKey, semester_keys: semesterKeys, week_ids: weekIds })
          },
        )
      })
    })
  },
)

router.post(
  "/admin/year/preview",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key)
    if (!yearKey) return res.status(400).json({ error: "Invalid year_key" })

    isPeriodClosed("year_summaries", "year_key", yearKey, (err, closed, closedAt) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) {
        return loadYearSummary(yearKey, (err2, meta) => {
          if (err2) return res.status(500).json({ error: err2.message })
          loadPeriodScores("year_scores", "year_key", yearKey, (err3, scores) => {
            if (err3) return res.status(500).json({ error: err3.message })
            const byGrade = { 10: [], 11: [], 12: [] }
              ; (scores || []).forEach((r) => {
                const g = Number(r.grade)
                if (g === 10 || g === 11 || g === 12) byGrade[g].push(r)
              })
            res.json({
              year_key: yearKey,
              week_ids: meta?.week_ids || [],
              closed_at: closedAt,
              scores_by_grade: byGrade,
            })
          })
        })
      }

      const ensureWeeks = (ids, semesterKeys) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })
        const now = time.now()
        db.run(
          `
            INSERT INTO year_summaries
            (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(year_key)
            DO UPDATE SET
              week_ids=excluded.week_ids,
              semester_keys=excluded.semester_keys,
              closed_at=excluded.closed_at,
              updated_at=excluded.updated_at
          `,
          [yearKey, JSON.stringify(ids), JSON.stringify(semesterKeys || []), null, now, now],
          (err2) => {
            if (err2) return res.status(500).json({ error: err2.message })
            loadAdjustments("year_adjustments", "year_key", yearKey, (err3, adjMap) => {
              if (err3) return res.status(500).json({ error: err3.message })
              computePeriodFromWeeks(ids, adjMap, (err4, rows) => {
                if (err4) return res.status(500).json({ error: err4.message })
                res.json({
                  year_key: yearKey,
                  week_ids: ids,
                  closed_at: null,
                  scores_by_grade: periodToRowsByGrade(rows),
                })
              })
            })
          },
        )
      }

      const semesterKeys = parseJsonList(req.body.semester_keys)
      if (semesterKeys.length) {
        return loadWeekIdsForSemesters(semesterKeys, (err2, ids) => {
          if (err2) return res.status(500).json({ error: err2.message })
          return ensureWeeks(ids, semesterKeys)
        })
      }

      loadYearSummary(yearKey, (err2, meta) => {
        if (err2) return res.status(500).json({ error: err2.message })
        const savedSemesterKeys = meta?.semester_keys || []
        return ensureWeeks(meta?.week_ids || [], savedSemesterKeys)
      })
    })
  },
)

router.post(
  "/admin/year/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key)
    const className = String(req.body.class_name || "").trim().toUpperCase()
    const plusPoints = Number(req.body.plus_points || 0)
    const minusPoints = Number(req.body.minus_points || 0)
    const reason = String(req.body.reason || "").trim()
    if (!yearKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("year_summaries", "year_key", yearKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Year closed" })
      upsertAdjustment("year_adjustments", "year_key", yearKey, className, plusPoints, minusPoints, reason, (err) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true })
      })
    })
  },
)

router.delete(
  "/admin/year/adjustment",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key || req.query.year_key)
    const className = String(req.body.class_name || req.query.class_name || "").trim().toUpperCase()
    if (!yearKey || !className) return res.status(400).json({ error: "Missing fields" })

    isPeriodClosed("year_summaries", "year_key", yearKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Year closed" })
      deleteAdjustment("year_adjustments", "year_key", yearKey, className, (deleteErr, deleted) => {
        if (deleteErr) return res.status(500).json({ error: deleteErr.message })
        res.json({ success: true, deleted })
      })
    })
  },
)

router.post(
  "/admin/year/close",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key)
    if (!yearKey) return res.status(400).json({ error: "Invalid year_key" })

    isPeriodClosed("year_summaries", "year_key", yearKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Year already closed" })

      const ensureWeeks = (ids, semesterKeys) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })

        ensureAllSemestersClosed(semesterKeys || [], (semesterLockErr) => {
          if (semesterLockErr) {
            const message =
              semesterLockErr.message && String(semesterLockErr.message).includes("Con hoc ky chua khoa")
                ? "Không thể tổng kết năm học khi vẫn còn học kỳ chưa khóa."
                : semesterLockErr.message
            return res.status(semesterLockErr.status || 500).json({ error: message })
          }

          ensureAllWeeksClosed(ids, (weekLockErr) => {
            if (weekLockErr) {
              const message =
                weekLockErr.message && String(weekLockErr.message).includes("Con tuan chua khoa")
                  ? "Tất cả các tuần trong năm học phải được tổng kết trước."
                  : weekLockErr.message
              return res.status(weekLockErr.status || 500).json({ error: message })
            }

            loadAdjustments("year_adjustments", "year_key", yearKey, (err2, adjMap) => {
              if (err2) return res.status(500).json({ error: err2.message })
              computePeriodFromWeeks(ids, adjMap, (err3, rows) => {
                if (err3) return res.status(500).json({ error: err3.message })
                const rowsByGrade = periodToRowsByGrade(rows)
                writePeriodScores("year_scores", "year_key", yearKey, rowsByGrade, (err4) => {
                  if (err4) return res.status(500).json({ error: err4.message })
                  const closedAt = time.now()
                  db.run(
                    `
                      INSERT INTO year_summaries
                      (year_key, week_ids, semester_keys, closed_at, created_at, updated_at)
                      VALUES(?,?,?,?,?,?)
                      ON CONFLICT(year_key)
                      DO UPDATE SET
                        week_ids=excluded.week_ids,
                        semester_keys=excluded.semester_keys,
                        closed_at=excluded.closed_at,
                        updated_at=excluded.updated_at
                    `,
                    [yearKey, JSON.stringify(ids), JSON.stringify(semesterKeys || []), closedAt, closedAt, closedAt],
                    (err5) => {
                      if (err5) return res.status(500).json({ error: err5.message })
                      res.json({ success: true, year_key: yearKey, closed_at: closedAt, week_ids: ids })
                    },
                  )
                })
              })
            })
          })
        })
      }

      const semesterKeys = parseJsonList(req.body.semester_keys)
      if (semesterKeys.length) {
        return loadWeekIdsForSemesters(semesterKeys, (err2, ids) => {
          if (err2) return res.status(500).json({ error: err2.message })
          return ensureWeeks(ids, semesterKeys)
        })
      }

      loadYearSummary(yearKey, (err2, meta) => {
        if (err2) return res.status(500).json({ error: err2.message })
        const savedSemesterKeys = meta?.semester_keys || []
        return ensureWeeks(meta?.week_ids || [], savedSemesterKeys)
      })
    })
  },
)

router.post(
  "/admin/year/reopen",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.body.year_key)
    if (!yearKey) return res.status(400).json({ error: "Invalid year_key" })
    db.run(
      `UPDATE year_summaries SET closed_at=NULL, updated_at=? WHERE year_key=?`,
      [time.now(), yearKey],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true, reopened: this.changes })
      },
    )
  },
)

router.get(
  "/admin/year/:yearKey/class/:className/breakdown",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.params.yearKey)
    const className = String(req.params.className || "").trim().toUpperCase()
    if (!yearKey || !className) return res.status(400).json({ error: "Invalid request" })

    loadPeriodSummary("year_summaries", "year_key", yearKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })
      loadAdjustments("year_adjustments", "year_key", yearKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          const row = (rows || []).find((r) => String(r.class_name).toUpperCase() === className)
          if (!row) return res.status(404).json({ error: "Class not found" })
          res.json({ year_key: yearKey, week_ids: weekIds, breakdown: row })
        })
      })
    })
  },
)

router.get(
  "/admin/year/:yearKey/export",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const yearKey = normalizeYearKey(req.params.yearKey)
    if (!yearKey) return res.status(400).json({ error: "Invalid year_key" })

    loadPeriodSummary("year_summaries", "year_key", yearKey, (err, meta) => {
      if (err) return res.status(500).json({ error: err.message })
      const weekIds = meta?.week_ids || []
      if (!weekIds.length) return res.status(400).json({ error: "No weeks selected" })

      loadAdjustments("year_adjustments", "year_key", yearKey, (err, adjMap) => {
        if (err) return res.status(500).json({ error: err.message })
        computePeriodFromWeeks(weekIds, adjMap, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          const byGrade = periodToRowsByGrade(rows)
          exportExcelWorkbookForPeriod(res, {
            fileName: `ket_qua_thi_dua_nam_hoc_${yearKey}.xlsx`,
            periodTitleByGrade: (g) => `KẾT QUẢ THI ĐUA CỜ ĐỎ KHỐI ${g}`,
            periodLine2: `Năm học ${yearKey}`,
            rowsByGrade: byGrade,
          })
        })
      })
    })
  },
)

/*
ADMIN: delete duty session (full control)
*/
router.delete(
  "/admin/session/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {

    const id = req.params.id

    ensureSessionWeekUnlocked(id, (lockErr) => {
      if (lockErr) return res.status(lockErr.status || 500).json({ error: lockErr.message })

      // FKs are enforced and configured with ON DELETE CASCADE, so deleting the session
      // will delete violations/signatures/logs/daily_bonus automatically.
      db.run(
        "DELETE FROM duty_sessions WHERE id=?",
        [id],
        function (err) {

          if (err) {
            return res.status(500).json({ error: err.message })
          }

          res.json({ success: true, deleted: this.changes })

        }
      )
    })

  }
)

function sendClassPeriodTree(req, res) {
  ; (async () => {
    try {
      const tree = await loadCurrentPeriodTree()
      res.json(tree)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })()
}

function sendClassPeriodSummary(periodType, getKey) {
  return (req, res) => {
    const className = req.session.user?.class_name
    const key = getKey(req)
    if (!className) return res.status(400).json({ error: "Missing class" })
    if (!key) return res.status(400).json({ error: "Invalid period" })

    loadComputedPeriodSummary(periodType, key, (err, result) => {
      if (err) return res.status(err.status || 500).json({ error: err.message })
      res.json(
        buildClassPeriodPayload({
          periodType,
          key,
          meta: result.meta,
          scoresByGrade: result.scores_by_grade,
          className,
        }),
      )
    })
  }
}

function sendClassWeekSummary(req, res) {
  const weekId = Number(req.params.weekId)
  const className = req.session.user?.class_name
  if (!weekId) return res.status(400).json({ error: "Invalid week" })
  if (!className) return res.status(400).json({ error: "Missing class" })

  loadComputedWeekSummary(weekId, (err, result) => {
    if (err) return res.status(err.status || 500).json({ error: err.message })
    const payload = buildClassPeriodPayload({
      periodType: "week",
      key: String(weekId),
      meta: { closed_at: result.closed_at, week_ids: [weekId] },
      scoresByGrade: result.scores_by_grade,
      className,
    })
    res.json({
      week: result.week,
      closed_at: result.closed_at,
      scores: result.scores || [],
      ...payload,
    })
  })
}

router.get(
  "/bancansu/period-tree",
  requireLogin,
  requireRole(["bancansu"]),
  sendClassPeriodTree,
)

router.get(
  "/bancansu/week/:weekId/summary",
  requireLogin,
  requireRole(["bancansu"]),
  sendClassWeekSummary,
)

router.get(
  "/bancansu/month/:monthKey/summary",
  requireLogin,
  requireRole(["bancansu"]),
  sendClassPeriodSummary("month", (req) => normalizeMonthKey(req.params.monthKey)),
)

router.get(
  "/bancansu/semester/:semesterKey/summary",
  requireLogin,
  requireRole(["bancansu"]),
  sendClassPeriodSummary("semester", (req) => normalizeSemesterKey(req.params.semesterKey)),
)

router.get(
  "/bancansu/year/:yearKey/summary",
  requireLogin,
  requireRole(["bancansu"]),
  sendClassPeriodSummary("year", (req) => normalizeYearKey(req.params.yearKey)),
)

router.get(
  "/gvcn/period-tree",
  requireLogin,
  requireRole(["gvcn"]),
  sendClassPeriodTree,
)

router.get(
  "/gvcn/month/:monthKey/summary",
  requireLogin,
  requireRole(["gvcn"]),
  sendClassPeriodSummary("month", (req) => normalizeMonthKey(req.params.monthKey)),
)

router.get(
  "/gvcn/semester/:semesterKey/summary",
  requireLogin,
  requireRole(["gvcn"]),
  sendClassPeriodSummary("semester", (req) => normalizeSemesterKey(req.params.semesterKey)),
)

router.get(
  "/gvcn/year/:yearKey/summary",
  requireLogin,
  requireRole(["gvcn"]),
  sendClassPeriodSummary("year", (req) => normalizeYearKey(req.params.yearKey)),
)

/*
BANCANSU: my incoming sessions (sessions where my class is duty_class) in current week
*/
router.get(
  "/bancansu/week",
  requireLogin,
  requireRole(["bancansu"]),
  (req, res) => {
    const today = time.today()
    const dutyClass = req.session.user?.class_name
    if (!dutyClass) return res.status(400).json({ error: "Missing class" })

    getWeekForDate(today, (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(400).json({ error: "No active week" })

      isWeekClosed(week.id, (err, closed) => {
        if (!err && !closed && !isSunday(today)) {
          ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
        }
      })

      aggregateSessions(
        "WHERE s.week_id=? AND s.duty_class=?",
        [week.id, dutyClass],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          withBaseScore((baseErr, baseScore) => {
            if (baseErr) return res.status(500).json({ error: baseErr.message })
            res.json({ week, sessions: rows || [], base_points: baseScore })
          })
        })
    })
  },
)

/*
BANCANSU: list all weeks (for selection)
*/
router.get(
  "/bancansu/weeks",
  requireLogin,
  requireRole(["bancansu"]),
  (req, res) => {
    db.all(
      `
        SELECT w.id, w.week_number, w.start_date, w.end_date, c.closed_at
        FROM schedule_weeks w
        LEFT JOIN week_closings c
          ON c.week_id = w.id
        ORDER BY w.week_number DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ weeks: rows || [] })
      },
    )
  },
)

/*
BANCANSU: sessions for a specific week (my class as duty_class)
*/
router.get(
  "/bancansu/week/:weekId",
  requireLogin,
  requireRole(["bancansu"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    const dutyClass = req.session.user?.class_name
    if (!weekId) return res.status(400).json({ error: "Invalid week" })
    if (!dutyClass) return res.status(400).json({ error: "Missing class" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        const today = time.today()
        const isCurrentWeek = week.start_date <= today && today <= week.end_date

        isWeekClosed(week.id, (err, closed) => {
          if (!err && !closed && isCurrentWeek && !isSunday(today)) {
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
          }

          aggregateSessions(
            "WHERE s.week_id=? AND s.duty_class=?",
            [week.id, dutyClass],
            (err, rows) => {
              if (err) return res.status(500).json({ error: err.message })
              withBaseScore((baseErr, baseScore) => {
                if (baseErr) return res.status(500).json({ error: baseErr.message })
                res.json({ week, sessions: rows || [], base_points: baseScore })
              })
            },
          )
        })
      },
    )
  },
)

/*
BANCANSU: view incoming session detail (current week)
*/
router.get(
  "/bancansu/session/:id",
  requireLogin,
  requireRole(["bancansu"]),
  (req, res) => {
    const id = req.params.id
    const dutyClass = req.session.user?.class_name
    if (!dutyClass) return res.status(400).json({ error: "Missing class" })

    db.get(
      `
        SELECT
          s.*,
          COALESCE(b.points, 0) as bonus_points,
          b.min_score as bonus_min_score,
          b.source as bonus_source,
          ds.photo_path as signature_photo_path,
          ds.signed_at as signature_signed_at
        FROM duty_sessions s
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        ${latestSignatureJoin("ds")}
        WHERE s.id=?
          AND s.duty_class=?
        LIMIT 1
      `,
      [id, dutyClass],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        db.get(
          `SELECT id,week_number,start_date,end_date FROM schedule_weeks WHERE id=? LIMIT 1`,
          [session.week_id],
          (err, week) => {
            if (err) return res.status(500).json({ error: err.message })

            db.all(
              `
                SELECT v.id,v.rule_id,v.quantity,v.note,
                       r.category,r.name,r.score_delta
                FROM duty_violations v
                LEFT JOIN rules r
                  ON r.id=v.rule_id
                WHERE v.session_id=?
                ORDER BY v.id DESC
              `,
              [id],
              (err, violations) => {
                if (err) return res.status(500).json({ error: err.message })
                res.json({ session, week: week || null, violations: violations || [] })
              },
            )
          },
        )
      },
    )
  },
)

/*
BANCANSU: get duty sessions by red_class
*/
router.get(
  "/sessions",
  requireLogin,
  (req, res) => {

    const redClass = req.query.red_class

    let whereSql = "WHERE 1=1"
    let params = []

    if (redClass) {
      whereSql += " AND s.red_class=?"
      params.push(redClass)
    }

    aggregateSessions(
      whereSql,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json(rows || [])
      }
    )

  }
)

/*
GVCN: list all weeks (for selection)
*/
router.get(
  "/gvcn/weeks",
  requireLogin,
  requireRole(["gvcn"]),
  (req, res) => {
    db.all(
      `
        SELECT w.id, w.week_number, w.start_date, w.end_date, c.closed_at
        FROM schedule_weeks w
        LEFT JOIN week_closings c
          ON c.week_id = w.id
        ORDER BY w.week_number DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ weeks: rows || [] })
      },
    )
  },
)

/*
GVCN: sessions for a specific week (my class as duty_class)
*/
router.get(
  "/gvcn/week/:weekId",
  requireLogin,
  requireRole(["gvcn"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    const dutyClass = req.session.user?.class_name
    if (!weekId) return res.status(400).json({ error: "Invalid week" })
    if (!dutyClass) return res.status(400).json({ error: "Missing class" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        const today = time.today()
        const isCurrentWeek = week.start_date <= today && today <= week.end_date

        isWeekClosed(week.id, (err, closed) => {
          if (!err && !closed && isCurrentWeek && !isSunday(today)) {
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => { })
          }

          aggregateSessions(
            "WHERE s.week_id=? AND s.duty_class=?",
            [week.id, dutyClass],
            (err, rows) => {
              if (err) return res.status(500).json({ error: err.message })
              withBaseScore((baseErr, baseScore) => {
                if (baseErr) return res.status(500).json({ error: baseErr.message })
                res.json({ week, sessions: rows || [], base_points: baseScore })
              })
            },
          )
        })
      },
    )
  },
)

/*
GVCN: view session detail (any week, my class)
*/
router.get(
  "/gvcn/session/:id",
  requireLogin,
  requireRole(["gvcn"]),
  (req, res) => {
    const id = req.params.id
    const dutyClass = req.session.user?.class_name
    if (!dutyClass) return res.status(400).json({ error: "Missing class" })

    db.get(
      `
        SELECT
          s.*,
          w.week_number,
          w.start_date,
          w.end_date,
          COALESCE(b.points, 0) as bonus_points,
          b.min_score as bonus_min_score,
          b.source as bonus_source,
          ds.photo_path as signature_photo_path,
          ds.signed_at as signature_signed_at
        FROM duty_sessions s
        JOIN schedule_weeks w
          ON w.id = s.week_id
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        ${latestSignatureJoin("ds")}
        WHERE s.id=?
          AND s.duty_class=?
        LIMIT 1
      `,
      [id, dutyClass],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        db.all(
          `
            SELECT v.id,v.rule_id,v.quantity,v.note,
                   r.category,r.name,r.score_delta
            FROM duty_violations v
            LEFT JOIN rules r
              ON r.id=v.rule_id
            WHERE v.session_id=?
            ORDER BY v.id DESC
          `,
          [id],
          (err, violations) => {
            if (err) return res.status(500).json({ error: err.message })
            res.json({
              session,
              week: {
                id: session.week_id,
                week_number: session.week_number,
                start_date: session.start_date,
                end_date: session.end_date,
              },
              violations: violations || [],
            })
          },
        )
      },
    )
  },
)

/*
GVCN: week ranking (only meaningful when week closed)
*/
router.get(
  "/gvcn/week/:weekId/summary",
  requireLogin,
  requireRole(["gvcn"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    const className = req.session.user?.class_name
    if (!weekId) return res.status(400).json({ error: "Invalid week" })
    if (!className) return res.status(400).json({ error: "Missing class" })

    loadComputedWeekSummary(weekId, (err, result) => {
      if (err) return res.status(err.status || 500).json({ error: err.message })
      const payload = buildClassPeriodPayload({
        periodType: "week",
        key: String(weekId),
        meta: { closed_at: result.closed_at, week_ids: [weekId] },
        scoresByGrade: result.scores_by_grade,
        className,
      })
      res.json({
        week: result.week,
        closed_at: result.closed_at,
        scores: result.scores || [],
        ...payload,
      })
    })
  },
)

module.exports = router

