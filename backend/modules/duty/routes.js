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

const BASE_WEEK_POINTS = 120

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
      cb(null, !!row, row?.closed_at || null)
    },
  )
}

function ensureDailySessionsForDate({ weekId, date }, cb) {
  if (!weekId || !date) return cb(null, { created: 0 })

  // Insert for all assignments of the week, but only if missing for that red_class on that date.
  // No unique constraint exists, so we rely on NOT EXISTS guard (safe with SQLite single-writer).
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
    [weekId, BASE_WEEK_POINTS, weekId],
    cb,
  )
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
    [weekId, weekId, weekId, BASE_WEEK_POINTS, BASE_WEEK_POINTS, BASE_WEEK_POINTS],
    cb,
  )
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
  db.get(
    `SELECT ${keyField} as period_key, week_ids, closed_at, updated_at FROM ${table} WHERE ${keyField}=? LIMIT 1`,
    [key],
    (err, row) => {
      if (err) return cb(err)
      if (!row) return cb(null, null)
      let weekIds = []
      try {
        weekIds = JSON.parse(String(row.week_ids || "[]"))
      } catch {}
      cb(null, { period_key: row.period_key, week_ids: weekIds, closed_at: row.closed_at || null, updated_at: row.updated_at || null })
    },
  )
}

function loadSemesterSummary(key, cb) {
  db.get(
    `SELECT semester_key, week_ids, month_keys, closed_at, updated_at FROM semester_summaries WHERE semester_key=? LIMIT 1`,
    [key],
    (err, row) => {
      if (err) return cb(err)
      if (!row) return cb(null, null)
      cb(null, {
        semester_key: row.semester_key,
        week_ids: parseJsonList(row.week_ids),
        month_keys: parseJsonList(row.month_keys),
        closed_at: row.closed_at || null,
        updated_at: row.updated_at || null,
      })
    },
  )
}

function loadYearSummary(key, cb) {
  db.get(
    `SELECT year_key, week_ids, semester_keys, closed_at, updated_at FROM year_summaries WHERE year_key=? LIMIT 1`,
    [key],
    (err, row) => {
      if (err) return cb(err)
      if (!row) return cb(null, null)
      cb(null, {
        year_key: row.year_key,
        week_ids: parseJsonList(row.week_ids),
        semester_keys: parseJsonList(row.semester_keys),
        closed_at: row.closed_at || null,
        updated_at: row.updated_at || null,
      })
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
      SELECT month_key, week_ids
      FROM month_summaries
      WHERE month_key IN (${placeholders})
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      const weekSet = new Set()
      ;(rows || []).forEach((r) => {
        parseJsonList(r.week_ids).forEach((id) => weekSet.add(Number(id)))
      })
      cb(null, Array.from(weekSet).filter((n) => Number.isFinite(n) && n > 0))
    },
  )
}

function loadWeekIdsForSemesters(semesterKeys, cb) {
  const keys = (semesterKeys || []).map(String).filter(Boolean)
  if (keys.length === 0) return cb(null, [])
  const placeholders = keys.map(() => "?").join(",")
  db.all(
    `
      SELECT semester_key, week_ids
      FROM semester_summaries
      WHERE semester_key IN (${placeholders})
    `,
    keys,
    (err, rows) => {
      if (err) return cb(err)
      const weekSet = new Set()
      ;(rows || []).forEach((r) => {
        parseJsonList(r.week_ids).forEach((id) => weekSet.add(Number(id)))
      })
      cb(null, Array.from(weekSet).filter((n) => Number.isFinite(n) && n > 0))
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
      ;(rows || []).forEach((r) => {
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
    ;(rows || []).forEach((r) => {
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
  if (m1) return `${m1[2]}-${m1[1]}`
  const m2 = s.match(/^(\d{4})-(\d{2})$/)
  if (m2) return `${m2[1]}-${m2[2]}`
  return null
}

function normalizeYearKey(input) {
  const s = String(input || "").trim()
  const m = s.match(/^(\d{4})-(\d{4})$/)
  if (!m) return null
  return `${m[1]}-${m[2]}`
}

function normalizeSemesterKey(input) {
  const s = String(input || "").trim()
  // Expect formats like "2025-2026-HK1" / "2025-2026-HK2" / "2025-2026_HK1"
  const m = s.match(/^(\d{4}-\d{4})[-_ ]?HK([12])$/i)
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

  ;([10, 11, 12]).forEach((g) => {
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

  ;([10, 11, 12]).forEach((g) => {
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
  db.serialize(() => {
    db.run("DELETE FROM weekly_scores WHERE week_id=?", [weekId])

    const stmt = db.prepare(`
      INSERT INTO weekly_scores
      (week_id,class_name,score,updated_at)
      VALUES(?,?,?,?)
    `)

    rows.forEach((r) => {
      stmt.run([weekId, r.class_name, r.score, time.now()])
    })

    stmt.finalize((err) => cb(err))
  })
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

function aggregateSessions(whereSql, params, cb){

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
      GROUP BY s.id
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
(req,res)=>{

  const today = time.today()
  const redClass = req.session.user?.class_name

  getWeekForDate(today, (err, week) => {

    if (err) return res.status(500).json({ error: err.message })
    if (!week) return res.json({})

    isWeekClosed(week.id, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      // Auto-create today's sessions for all assignments (non-Sunday) when the new day starts.
      if (!closed && !isSunday(today)) {
        ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
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
    (err,session)=>{

      if(err) return res.status(500).json({error:err.message})

      if(!session){
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
      (err,violations)=>{

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
(req,res)=>{

  const today = time.today()
  const redClass = req.session.user?.class_name
  if(!redClass) return res.status(400).json({error:"Missing class"})

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
    (err,existing)=>{

      if(err){
        return res.status(500).json({error:err.message})
      }

      if(existing){
        return res.json({
          success:true,
          existing:true,
          session_id:existing.id
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
      function(err){

        if(err){
          return res.status(500).json({error:err.message})
        }

        res.json({
          success:true,
          existing:false,
          session_id:this.lastID
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
  (req,res)=>{

    const today = time.today()
    const redClass = req.session.user?.class_name
    if(!redClass) return res.status(400).json({error:"Missing class"})

    getWeekForDate(today, (err, week) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!week) return res.status(400).json({ error: "No active week" })

      isWeekClosed(week.id, (err, closed) => {
        if (!err && !closed && !isSunday(today)) {
          ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
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
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
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
  (req,res)=>{

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
        (err,session)=>{

        if(err) return res.status(500).json({error:err.message})
        if(!session) return res.status(404).json({error:"Session not found"})

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
              (err,violations)=>{
                if(err) return res.status(500).json({error:err.message})
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
(req,res)=>{

  const {session_id,rule_id,quantity,note} = req.body

  const redClass = req.session.user?.class_name

  if(!session_id || !rule_id){
    return res.status(400).json({error:"Missing fields"})
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
    (err,row)=>{

      if(err) return res.status(500).json({error:err.message})
      if(!row) return res.status(404).json({error:"Session not found"})

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
(req,res)=>{

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
    (err,row)=>{

      if(err) return res.status(500).json({error:err.message})
      if(!row) return res.status(404).json({error:"Violation not found"})

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
      `SELECT id FROM duty_sessions WHERE id=? LIMIT 1`,
      [session_id],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

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
              () => {},
            )
            res.json({ success: true, id: this.lastID })
          },
        )
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
        SELECT v.id, v.session_id
        FROM duty_violations v
        WHERE v.id=?
        LIMIT 1
      `,
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Violation not found" })

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
              () => {},
            )
            res.json({ success: true })
          },
        )
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
        SELECT v.id, v.session_id
        FROM duty_violations v
        WHERE v.id=?
        LIMIT 1
      `,
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!row) return res.status(404).json({ error: "Violation not found" })

        db.run(
          `DELETE FROM duty_violations WHERE id=?`,
          [id],
          (err) => {
            if (err) return res.status(500).json({ error: err.message })
            db.run(
              `INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES(?,?,?)`,
              [row.session_id, "edit:remove_violation", time.now()],
              () => {},
            )
            res.json({ success: true })
          },
        )
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
(req,res)=>{

  const {session_id,pin,photo_data} = req.body

  // photo_data is optional (fallback mode) - PIN is the real authorization.
  if(!session_id || !pin){
    return res.status(400).json({error:"Missing fields"})
  }

  const redClass = req.session.user?.class_name
  const provided = String(pin || "").trim()

  if(!/^\d{6}$/.test(provided)){
    return res.status(400).json({error:"Invalid pin"})
  }

  db.get(
    `
      SELECT *
      FROM duty_sessions
      WHERE id=?
        AND red_class=?
      LIMIT 1
    `,
    [session_id, redClass],
    (err,session)=>{

      if(err) return res.status(500).json({error:err.message})
      if(!session) return res.status(404).json({error:"Session not found"})

      const dutyClass = session.duty_class
      const weekId = session.week_id

      isWeekClosed(weekId, (err, closed) => {
        if (err) return res.status(500).json({ error: err.message })
        if (closed) return res.status(403).json({ error: "Week closed" })

      db.get(
        `
          SELECT a.pin_bcs
          FROM classes c
          LEFT JOIN accounts a
          ON a.class_id = c.id
          WHERE c.name=?
          LIMIT 1
        `,
        [dutyClass],
        (err,row)=>{

          if(err) return res.status(500).json({error:err.message})

          const expected = String(row?.pin_bcs || "").trim()

          if(!expected || expected !== provided){
            return res.status(403).json({error:"Invalid pin"})
                      }

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

            try{
              fs.writeFileSync(absPath, buf)
            }catch(err){
              return res.status(500).json({error:"Cannot save photo"})
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
            (err)=>{

              if(err){
                return res.status(500).json({error:err.message})
              }

              computeViolationHash(session_id, (err, hash) => {
                if (err) return res.status(500).json({ error: err.message })

                db.run(
                  `
                    UPDATE duty_sessions
                    SET status='signed',
                        signed_at=?,
                        signed_snapshot_hash=?
                    WHERE id=?
                  `,
                  [time.now(), hash, session_id],
                  (err) => {

                    if (err) {
                      return res.status(500).json({ error: err.message })
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

            }
          )

        }
      )

      })
    }
  )

})

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
            },
          )
        })
      },
    )
  },
)

/*
ADMIN: duty sessions by day
*/
router.get(
  "/admin/day",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const date = (req.query.date || time.today()).toString()

    aggregateSessions(
      "WHERE s.date=?",
      [date],
      (err,rows)=>{
        if(err) return res.status(500).json({error:err.message})
        res.json({date, sessions: rows})
      }
    )

  }
)

/*
ADMIN: duty sessions by week_id
*/
router.get(
  "/admin/week/:weekId",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const weekId = req.params.weekId

    aggregateSessions(
      "WHERE s.week_id=?",
      [weekId],
      (err,rows)=>{
        if(err) return res.status(500).json({error:err.message})
        res.json({week_id: Number(weekId), sessions: rows})
      }
    )

  }
)

/*
ADMIN: weekly trends by grade (for dashboard line chart)
query: ?grade=10|11|12
*/
router.get(
  "/admin/weekly-trends",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const grade = Number(req.query.grade || 10)
    if (![10, 11, 12].includes(grade)) {
      return res.status(400).json({ error: "Invalid grade" })
    }

    db.all(
      `
        SELECT id, week_number, start_date, end_date
        FROM schedule_weeks
        ORDER BY week_number ASC
      `,
      [],
      (err, weeks) => {
        if (err) return res.status(500).json({ error: err.message })

        db.all(
          `
            SELECT name
            FROM classes
            WHERE grade=?
            ORDER BY name ASC
          `,
          [grade],
          (err2, classes) => {
            if (err2) return res.status(500).json({ error: err2.message })

            const classNames = classes.map((c) => c.name)
            if (classNames.length === 0) {
              return res.json({ weeks, classes: [] })
            }

            db.all(
              `
                SELECT week_id, class_name, score
                FROM weekly_scores
                WHERE class_name IN (${classNames.map(() => "?").join(",")})
              `,
              classNames,
              (err3, rows) => {
                if (err3) return res.status(500).json({ error: err3.message })

                const byClass = new Map()
                classNames.forEach((n) => byClass.set(n, new Map()))
                rows.forEach((r) => {
                  if (!byClass.has(r.class_name)) byClass.set(r.class_name, new Map())
                  byClass.get(r.class_name).set(r.week_id, Number(r.score || 0))
                })

                const out = classNames.map((name) => ({
                  class_name: name,
                  scores: weeks.map((w) => {
                    const v = byClass.get(name)?.get(w.id)
                    return typeof v === "number" ? v : null
                  }),
                }))

                res.json({ weeks, classes: out })
              },
            )
          },
        )
      },
    )
  },
)

/*
ADMIN: query sessions (week + optional date + optional duty_class)
*/
router.get(
"/admin/query",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const weekId = Number(req.query.week_id)
  const date = req.query.date ? req.query.date.toString() : null
  const className = req.query.class_name ? req.query.class_name.toString() : null
  const grade = req.query.grade ? String(req.query.grade) : null

  if(!weekId){
    return res.status(400).json({error:"Missing week_id"})
  }

  const params = [weekId]
  let where = "WHERE s.week_id=?"

  if(date){
    where += " AND s.date=?"
    params.push(date)
  }

  if(className){
    where += " AND s.duty_class=?"
    params.push(className)
  }

  if(grade){
    where += " AND s.duty_class LIKE ?"
    params.push(`${grade}A%`)
  }

  aggregateSessions(where, params, (err, rows)=>{
    if(err) return res.status(500).json({error:err.message})
    res.json({week_id: weekId, date, class_name: className, sessions: rows})
  })

  }
)

/*
ADMIN: duty session detail
*/
router.get(
  "/admin/session/:id",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const id = req.params.id

    db.get(
      `
        SELECT
          s.*,
          COALESCE(b.points, 0) as bonus_points,
          b.min_score as bonus_min_score,
          b.all_above_9 as bonus_all_above_9,
          b.source as bonus_source,
          b.periods_json as bonus_periods_json,
          ds.photo_path as signature_photo_path,
          ds.signed_at as signature_signed_at
        FROM duty_sessions s
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        ${latestSignatureJoin("ds")}
        WHERE s.id=?
        LIMIT 1
      `,
      [id],
      (err,session)=>{

        if(err) return res.status(500).json({error:err.message})
        if(!session) return res.status(404).json({error:"Session not found"})

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
          (err,violations)=>{

            if(err) return res.status(500).json({error:err.message})

            db.all(
              `
                SELECT id, action, created_at
                FROM duty_revision_logs
                WHERE session_id=?
                ORDER BY id DESC
              `,
              [id],
              (err, revisions)=>{

                if(err) return res.status(500).json({error:err.message})

                db.all(
                  `
                    SELECT id, photo_path, signed_at
                    FROM duty_signatures
                    WHERE session_id=?
                    ORDER BY id DESC
                  `,
                  [id],
                  (err, signatures)=>{

                    if(err) return res.status(500).json({error:err.message})

                    res.json({
                      session: {
                        ...session,
                        status_label: dutyStatusLabel(session.status),
                      },
                      violations,
                      revisions: (revisions || []).map((r) => ({
                        ...r,
                        action_label: revisionActionLabel(r.action),
                      })),
                      signatures
                    })

                  }
                )

              }
            )

          }
        )

      }
    )

  }
)

/*
ADMIN: close week + compute weekly_scores
*/
router.post(
  "/admin/week/:weekId/close",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const weekId = Number(req.params.weekId)
    if(!weekId) return res.status(400).json({error:"Invalid week"})

    isWeekClosed(weekId, (err, closed)=>{
      if(err) return res.status(500).json({error:err.message})
      if(closed) return res.status(409).json({error:"Week already closed"})

      db.all(
        `
          SELECT grade, COUNT(*) as upload_count
          FROM bonus_uploads
          WHERE week_id=?
          GROUP BY grade
        `,
        [weekId],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message })

          const required = ["10", "11", "12"]
          const uploaded = new Set((rows || []).map((r) => String(r.grade)))
          const missing = required.filter((g) => !uploaded.has(g))

          if (missing.length > 0) {
            return res.status(400).json({
              error: `Chưa upload sổ đầu bài cho khối ${missing.join(", ")}`,
            })
          }

      weekSessionCounts(weekId, (err, counts) => {
        if (err) return res.status(500).json({ error: err.message })

        computeWeekScores(weekId, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })

        writeWeeklyScores(weekId, rows, (err) => {
          if (err) return res.status(500).json({ error: err.message })

          const closedAt = time.now()
          db.run(
            `
              INSERT OR REPLACE INTO week_closings
              (week_id, closed_at)
              VALUES(?,?)
            `,
            [weekId, closedAt],
            (err) => {
              if (err) return res.status(500).json({ error: err.message })
              res.json({
                success: true,
                week_id: weekId,
                closed_at: closedAt,
                counts,
                rows,
              })
            },
          )
        })
      })
      })
        },
      )

    })

  }
)

/*
ADMIN: reopen week (unlock editing)
*/
router.post(
  "/admin/week/:weekId/reopen",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.run(
      "DELETE FROM week_closings WHERE week_id=?",
      [weekId],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true, reopened: this.changes })
      },
    )
  },
)

/*
ADMIN: week summary
*/
router.get(
  "/admin/week/:weekId/summary",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const weekId = Number(req.params.weekId)
    if(!weekId) return res.status(400).json({error:"Invalid week"})

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week)=>{
        if(err) return res.status(500).json({error:err.message})
        if(!week) return res.status(404).json({error:"Week not found"})

        db.get(
          `SELECT closed_at FROM week_closings WHERE week_id=? LIMIT 1`,
          [weekId],
          (err, closed)=>{
            if(err) return res.status(500).json({error:err.message})

            if (closed?.closed_at) {
              db.all(
                `
                  SELECT class_name, score, updated_at
                  FROM weekly_scores
                  WHERE week_id=?
                  ORDER BY score DESC
                `,
                [weekId],
                (err, scores)=>{
                  if(err) return res.status(500).json({error:err.message})
                  res.json({
                    week,
                    closed_at: closed?.closed_at || null,
                    scores
                  })
                }
              )
              return
            }

            computeWeekScores(weekId, (err2, rows) => {
              if (err2) return res.status(500).json({ error: err2.message })
              const scores = (rows || []).map((r) => ({
                class_name: r.class_name,
                score: r.score,
                updated_at: null,
              }))
              res.json({
                week,
                closed_at: null,
                scores,
              })
            })

          }
        )

      }
    )

  }
)

/*
ADMIN: breakdown for a class in a week (base + bonus + violations)
*/
router.get(
  "/admin/week/:weekId/class/:className/breakdown",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    const className = String(req.params.className || "").trim().toUpperCase()
    if (!weekId || !className) return res.status(400).json({ error: "Invalid request" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        weekBreakdowns(weekId, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          const row = (rows || []).find((r) => String(r.class_name).toUpperCase() === className)
          if (!row) return res.status(404).json({ error: "Class not found" })
          db.all(
            `
              SELECT
                s.id,
                s.date,
                s.red_class,
                s.status,
                COALESCE(b.points, 0) as bonus_points,
                b.min_score,
                b.all_above_9,
                b.source,
                b.periods_json
              FROM duty_sessions s
              LEFT JOIN daily_bonus b
                ON b.week_id = s.week_id
               AND b.date = s.date
               AND b.class_name = s.duty_class
              WHERE s.week_id=?
                AND s.duty_class=?
              ORDER BY s.date ASC
            `,
            [weekId, className],
            (err2, sessions) => {
              if (err2) return res.status(500).json({ error: err2.message })

              db.all(
                `
                  SELECT
                    s.date,
                    r.name,
                    r.category,
                    r.score_delta,
                    v.quantity,
                    v.note
                  FROM duty_violations v
                  JOIN duty_sessions s
                    ON s.id = v.session_id
                  LEFT JOIN rules r
                    ON r.id = v.rule_id
                  WHERE s.week_id=?
                    AND s.duty_class=?
                  ORDER BY s.date ASC, v.id ASC
                `,
                [weekId, className],
                (err3, vioRows) => {
                  if (err3) return res.status(500).json({ error: err3.message })

                  db.get(
                    `
                      SELECT points, reason
                      FROM weekly_bonus
                      WHERE week_id=? AND class_name=?
                      LIMIT 1
                    `,
                    [weekId, className],
                    (err4, weeklyBonus) => {
                      if (err4) return res.status(500).json({ error: err4.message })

                      const byDate = new Map()
                      ;(sessions || []).forEach((s) => {
                        let periods = []
                        try {
                          periods = JSON.parse(String(s.periods_json || "[]"))
                        } catch {}
                        byDate.set(s.date, {
                          date: s.date,
                          red_class: s.red_class,
                          status: s.status,
                          bonus_points: Number(s.bonus_points || 0),
                          min_score: s.min_score,
                          all_above_9: s.all_above_9,
                          source: s.source || null,
                          periods,
                          violations: [],
                        })
                      })
                      ;(vioRows || []).forEach((v) => {
                        const item = byDate.get(v.date) || {
                          date: v.date,
                          red_class: null,
                          status: null,
                          bonus_points: 0,
                          min_score: null,
                          all_above_9: null,
                          source: null,
                          periods: [],
                          violations: [],
                        }
                        item.violations.push({
                          name: v.name,
                          category: v.category,
                          score_delta: v.score_delta,
                          quantity: v.quantity,
                          note: v.note,
                        })
                        byDate.set(v.date, item)
                      })

                      const days = Array.from(byDate.values()).sort((a, b) =>
                        String(a.date).localeCompare(String(b.date)),
                      )

                      res.json({
                        week,
                        base_points: BASE_WEEK_POINTS,
                        breakdown: row,
                        days,
                        weekly_bonus: weeklyBonus || null,
                      })
                    },
                  )
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
ADMIN: export weekly ranking to Excel workbook (3 sheets: grades 10/11/12)
*/
router.get(
  "/admin/week/:weekId/export",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        weekBreakdowns(weekId, (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })

          const byGrade = { 10: [], 11: [], 12: [] }
          ;(rows || []).forEach((r) => {
            const g = Number(r.grade)
            if (g === 10 || g === 11 || g === 12) byGrade[g].push(r)
          })

          function formatDDMM(iso) {
            if (!iso) return ""
            const parts = String(iso).split("-")
            if (parts.length !== 3) return ""
            return `${parts[2]}/${parts[1]}`
          }

          function assignCompetitionRanks(list) {
            let prevScore = null
            let prevRank = 0
            return list.map((r, idx) => {
              const s = Number(r.total_score || 0)
              let rank
              if (prevScore != null && s === prevScore) rank = prevRank
              else rank = idx + 1
              prevScore = s
              prevRank = rank
              return { ...r, rank }
            })
          }

          function annotateNotes(list) {
            const rankCounts = new Map()
            list.forEach((r) => {
              const rk = Number(r.rank || 0)
              if (!rk) return
              rankCounts.set(rk, (rankCounts.get(rk) || 0) + 1)
            })

            const lastRank = list.reduce(
              (m, r) => Math.max(m, Number(r.rank || 0)),
              0,
            )

            function label(base, rk) {
              const c = rankCounts.get(rk) || 0
              if (c > 1) return `ĐỒNG ${base}`
              return base
            }

            return list.map((r) => {
              const rk = Number(r.rank || 0)
              let note = ""
              if (rk === 1) note = label("HẠNG NHẤT", rk)
              else if (rk === 2) note = label("HẠNG NHÌ", rk)
              else if (rk === 3) note = label("HẠNG BA", rk)
              else if (rk === lastRank) note = label("HẠNG CHÓT", rk)
              return { ...r, note }
            })
          }

          const workbook = new ExcelJS.Workbook()

          function parseClass(name) {
            const g = parseInt(String(name || ""), 10) || 0
            const aPos = String(name || "").indexOf("A")
            const num =
              aPos >= 0 ? parseInt(String(name || "").slice(aPos + 1), 10) || 0 : 0
            return { g, num, name: String(name || "") }
          }

          ;([10, 11, 12]).forEach((g) => {
            const list0 = (byGrade[g] || []).slice()

            // Rankings/notes are based on score, but the sheet rows are ordered by class name.
            const rankedByScore = annotateNotes(
              assignCompetitionRanks(
                list0.slice().sort((a, b) => Number(b.total_score) - Number(a.total_score)),
              ),
            )

            const rankMap = new Map()
            const noteMap = new Map()
            rankedByScore.forEach((r) => {
              rankMap.set(String(r.class_name), Number(r.rank || 0))
              noteMap.set(String(r.class_name), String(r.note || ""))
            })

            const ordered = list0.slice().sort((a, b) => {
              const aa = parseClass(a.class_name)
              const bb = parseClass(b.class_name)
              if (aa.g !== bb.g) return aa.g - bb.g
              if (aa.num !== bb.num) return aa.num - bb.num
              return aa.name.localeCompare(bb.name)
            })

            const ws = workbook.addWorksheet(`Khoi ${g}`)

            const baseFont = { name: "Times New Roman", size: 12 }

            ws.columns = [
              { header: "Lớp", key: "class_name", width: 10 },
              { header: "Điểm cộng", key: "plus_points", width: 14 },
              { header: "Điểm trừ", key: "minus_points", width: 14 },
              { header: "Tổng điểm", key: "total_score", width: 14 },
              { header: "Xếp hạng", key: "rank", width: 10 },
              { header: "Ghi chú", key: "note", width: 20 },
            ]

            const title = `KẾT QUẢ THI ĐUA CỜ ĐỎ KHỐI ${g}`
            const line2 = `Tuần ${week.week_number}: Từ ngày ${formatDDMM(
              week.start_date,
            )} đến ngày ${formatDDMM(week.end_date)}`

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

            // Header row at 4
            const headerRow = ws.getRow(4)
            headerRow.values = ["Lớp", "Điểm cộng", "Điểm trừ", "Tổng điểm", "Xếp hạng", "Ghi chú"]
            headerRow.font = { ...baseFont, bold: true }
            headerRow.alignment = { horizontal: "center", vertical: "middle" }
            headerRow.height = 18

            // Data rows from row 5
            let rowIndex = 5
            ordered.forEach((r) => {
              const cls = String(r.class_name)
              const row = ws.getRow(rowIndex++)
              row.getCell(1).value = cls
              row.getCell(2).value = Number(r.plus_points || 0)
              row.getCell(3).value = Number(r.minus_points || 0)
              row.getCell(4).value = Number(r.total_score || 0)
              row.getCell(5).value = Number(rankMap.get(cls) || 0)
              const note = String(noteMap.get(cls) || "")
              row.getCell(6).value = note
              if (note) row.getCell(6).font = { ...baseFont, bold: true }
              const noteUpper = note.toUpperCase()
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

            // Default styling: Times New Roman 12, centered, with light borders.
            ws.eachRow({ includeEmpty: false }, (row) => {
              row.eachCell((cell) => {
                if (!cell.font) cell.font = { ...baseFont }
                if (!cell.alignment)
                  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
                cell.border = {
                  top: { style: "thin", color: { argb: "FF000000" } },
                  left: { style: "thin", color: { argb: "FF000000" } },
                  bottom: { style: "thin", color: { argb: "FF000000" } },
                  right: { style: "thin", color: { argb: "FF000000" } },
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
              res.setHeader(
                "Content-Disposition",
                `attachment; filename="ket_qua_thi_dua_tuan_${week.week_number}.xlsx"`,
              )
              res.send(Buffer.from(buf))
            })
            .catch((err) => {
              res.status(500).json({ error: err?.message || "Export failed" })
            })
        })
      },
    )
  },
)

/*
ADMIN: week stats (draft/signed counts)
*/
router.get(
  "/admin/week/:weekId/stats",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.params.weekId)
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    weekSessionCounts(weekId, (err, counts) => {
      if (err) return res.status(500).json({ error: err.message })

      isWeekClosed(weekId, (err, closed, closedAt) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({
          week_id: weekId,
          closed,
          closed_at: closedAt,
          ...counts,
        })
      })
    })
  },
)

function periodToRowsByGrade(rows) {
  const byGrade = { 10: [], 11: [], 12: [] }
  ;(rows || []).forEach((r) => {
    const g = Number(r.grade)
    if (g === 10 || g === 11 || g === 12) byGrade[g].push(r)
  })
  ;([10, 11, 12]).forEach((g) => {
    const sorted = (byGrade[g] || []).slice().sort((a, b) => {
      const ds = Number(b.total_score) - Number(a.total_score)
      if (ds !== 0) return ds
      const aa = parseClassNatural(a.class_name)
      const bb = parseClassNatural(b.class_name)
      if (aa.num !== bb.num) return aa.num - bb.num
      return aa.name.localeCompare(bb.name)
    })
    byGrade[g] = annotateNotesAndRanks(sorted)
  })
  return byGrade
}

function writePeriodScores(scoreTable, keyField, key, rowsByGrade, cb) {
  const now = time.now()
  db.serialize(() => {
    db.run(`DELETE FROM ${scoreTable} WHERE ${keyField}=?`, [key])
    const stmt = db.prepare(
      `
        INSERT INTO ${scoreTable}
        (${keyField}, class_name, grade, plus_points, minus_points, total_score, rank, note, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
      `,
    )
    ;([10, 11, 12]).forEach((g) => {
      ;(rowsByGrade[g] || []).forEach((r) => {
        stmt.run([
          key,
          r.class_name,
          Number(r.grade || g),
          Number(r.plus_points || 0),
          Number(r.minus_points || 0),
          Number(r.total_score || 0),
          Number(r.rank || 0),
          String(r.note || ""),
          now,
        ])
      })
    })
    stmt.finalize((err) => cb(err))
  })
}

function loadPeriodScores(scoreTable, keyField, key, cb) {
  db.all(
    `
      SELECT class_name, grade, plus_points, minus_points, total_score, rank, note, updated_at
      FROM ${scoreTable}
      WHERE ${keyField}=?
      ORDER BY grade ASC, rank ASC, class_name ASC
    `,
    [key],
    cb,
  )
}

/*
ADMIN: list months (saved)
*/
router.get(
  "/admin/month/list",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.all(
      `
        SELECT month_key, week_ids, closed_at, updated_at
        FROM month_summaries
        ORDER BY month_key DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        const out = (rows || []).map((r) => ({
          month_key: r.month_key,
          week_ids: parseJsonList(r.week_ids),
          closed_at: r.closed_at || null,
          updated_at: r.updated_at || null,
        }))
        res.json({ months: out })
      },
    )
  },
)

/*
ADMIN: save month (link weeks)
body: { month_key, week_ids }
*/
router.post(
  "/admin/month/save",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    const weekIds = parseWeekIds(req.body.week_ids)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })
    if (!weekIds.length) return res.status(400).json({ error: "Missing week_ids" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(409).json({ error: "Month closed" })
      upsertPeriodSummary("month_summaries", "month_key", monthKey, weekIds, null, (err2) => {
        if (err2) return res.status(500).json({ error: err2.message })
        res.json({ success: true, month_key: monthKey, week_ids: weekIds })
      })
    })
  },
)

/*
ADMIN: month preview (compute without locking)
body: { month_key: 'MM/YYYY' or 'YYYY-MM', week_ids: number[] }
*/
router.post(
  "/admin/month/preview",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const monthKey = normalizeMonthKey(req.body.month_key)
    const weekIds = parseWeekIds(req.body.week_ids)
    if (!monthKey) return res.status(400).json({ error: "Invalid month_key" })

    isPeriodClosed("month_summaries", "month_key", monthKey, (err, closed, closedAt) => {
      if (err) return res.status(500).json({ error: err.message })

      // If locked, serve stored snapshot.
      if (closed) {
        loadPeriodScores("month_scores", "month_key", monthKey, (err, scores) => {
          if (err) return res.status(500).json({ error: err.message })
          const byGrade = { 10: [], 11: [], 12: [] }
          ;(scores || []).forEach((r) => {
            const g = Number(r.grade)
            if (g === 10 || g === 11 || g === 12) byGrade[g].push(r)
          })
          res.json({
            month_key: monthKey,
            week_ids: weekIds,
            closed_at: closedAt,
            scores_by_grade: byGrade,
          })
        })
        return
      }

      const ensureWeeks = (ids) => {
        if (!ids.length) return res.status(400).json({ error: "Missing week_ids" })
        // Persist selection (unlocked) so detail/export can reuse it.
        upsertPeriodSummary("month_summaries", "month_key", monthKey, ids, null, (err2) => {
          if (err2) return res.status(500).json({ error: err2.message })

          loadAdjustments("month_adjustments", "month_key", monthKey, (err3, adjMap) => {
            if (err3) return res.status(500).json({ error: err3.message })
            computePeriodFromWeeks(ids, adjMap, (err4, rawRows) => {
              if (err4) return res.status(500).json({ error: err4.message })
              const rows = toMonthRows(rawRows)
              res.json({
                month_key: monthKey,
                week_ids: ids,
                closed_at: null,
                scores_by_grade: periodToRowsByGrade(rows),
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

/*
ADMIN: save month adjustment (not tied to any week)
*/
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

/*
ADMIN: upload month adjustments from Excel
body: { month_key, file_data(base64), file_name? }
Excel format: from row 3, col A = class_name, col B = delta points (+/-)
*/
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

      let buf
      try {
        buf = Buffer.from(fileData, "base64")
      } catch {
        return res.status(400).json({ error: "Invalid file_data" })
      }

      let wb
      try {
        wb = xlsx.read(buf, { type: "buffer" })
      } catch (e) {
        return res.status(400).json({ error: e?.message || "Cannot read Excel file" })
      }

      const firstSheetName = wb.SheetNames?.[0]
      if (!firstSheetName) return res.status(400).json({ error: "Excel has no sheet" })
      const ws = wb.Sheets[firstSheetName]
      if (!ws || !ws["!ref"]) return res.status(400).json({ error: "Excel sheet is empty" })

      const range = xlsx.utils.decode_range(ws["!ref"])
      const rows = []
      for (let R = 2; R <= range.e.r; R += 1) {
        const classCell = ws[xlsx.utils.encode_cell({ c: 0, r: R })]
        const deltaCell = ws[xlsx.utils.encode_cell({ c: 1, r: R })]

        const className = String(classCell?.v || "").trim().toUpperCase()
        if (!className) continue
        const delta = Number(deltaCell?.v || 0)
        if (!Number.isFinite(delta)) continue

        rows.push({
          class_name: className,
          plus_points: delta > 0 ? delta : 0,
          minus_points: delta < 0 ? -delta : 0,
        })
      }

      if (!rows.length) {
        return res.status(400).json({ error: "No valid data rows from row 3 (A=class, B=points)" })
      }

      const now = time.now()
      db.serialize(() => {
        db.run("BEGIN IMMEDIATE", (errBegin) => {
          if (errBegin) return res.status(500).json({ error: errBegin.message })

          const stmt = db.prepare(
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
          )

          rows.forEach((r) => {
            stmt.run([
              monthKey,
              r.class_name,
              r.plus_points,
              r.minus_points,
              `Nhập từ Excel: ${fileName}`,
              now,
              now,
            ])
          })

          stmt.finalize((errStmt) => {
            if (errStmt) {
              return db.run("ROLLBACK", () => res.status(500).json({ error: errStmt.message }))
            }
            db.run("COMMIT", (errCommit) => {
              if (errCommit) return res.status(500).json({ error: errCommit.message })
              res.json({ success: true, imported: rows.length })
            })
          })
        })
      })
    })
  },
)

/*
ADMIN: close month (lock + store snapshot scores)
body: { month_key, week_ids }
*/
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
              ;(weekMetaRows || []).forEach((w) => {
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
            fileName: `ket_qua_thi_dua_thang_${monthKey}.xlsx`,
            periodTitleByGrade: (g) => `KẾT QUẢ THI ĐUA CỜ ĐỎ KHỐI ${g}`,
            periodLine2: `Tháng ${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}`,
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
        SELECT semester_key, week_ids, month_keys, closed_at, updated_at
        FROM semester_summaries
        ORDER BY semester_key DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        const out = (rows || []).map((r) => ({
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
            ;(scores || []).forEach((r) => {
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
          const hk = semesterKey.toUpperCase().endsWith("HK1") ? "I" : "II"
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
        SELECT year_key, week_ids, semester_keys, closed_at, updated_at
        FROM year_summaries
        ORDER BY year_key DESC
      `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message })
        const out = (rows || []).map((r) => ({
          year_key: r.year_key,
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
            ;(scores || []).forEach((r) => {
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
  (req,res)=>{

    const id = req.params.id

    // FKs are enforced and configured with ON DELETE CASCADE, so deleting the session
    // will delete violations/signatures/logs/daily_bonus automatically.
    db.run(
      "DELETE FROM duty_sessions WHERE id=?",
      [id],
      function(err){

        if(err){
          return res.status(500).json({error:err.message})
        }

        res.json({success:true,deleted:this.changes})

      }
    )

  }
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
          ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
        }
      })

      aggregateSessions(
        "WHERE s.week_id=? AND s.duty_class=?",
        [week.id, dutyClass],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message })
          res.json({ week, sessions: rows || [] })
        },
      )
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
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
          }

          aggregateSessions(
            "WHERE s.week_id=? AND s.duty_class=?",
            [week.id, dutyClass],
            (err, rows) => {
              if (err) return res.status(500).json({ error: err.message })
              res.json({ week, sessions: rows || [] })
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
  (req,res)=>{

    const redClass = req.query.red_class
    
    let whereSql = "WHERE 1=1"
    let params = []

    if(redClass){
      whereSql += " AND s.red_class=?"
      params.push(redClass)
    }

    aggregateSessions(
      whereSql,
      params,
      (err, rows) => {
        if(err) return res.status(500).json({error:err.message})
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
            ensureDailySessionsForDate({ weekId: week.id, date: today }, () => {})
          }

          aggregateSessions(
            "WHERE s.week_id=? AND s.duty_class=?",
            [week.id, dutyClass],
            (err, rows) => {
              if (err) return res.status(500).json({ error: err.message })
              res.json({ week, sessions: rows || [] })
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
    if (!weekId) return res.status(400).json({ error: "Invalid week" })

    db.get(
      `SELECT * FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        isWeekClosed(weekId, (err, closed, closedAt) => {
          if (err) return res.status(500).json({ error: err.message })
          if (!closed) {
            return res.json({ week, closed_at: null, scores: [] })
          }

          db.all(
            `
              SELECT class_name, score, updated_at
              FROM weekly_scores
              WHERE week_id=?
              ORDER BY score DESC
            `,
            [weekId],
            (err, scores) => {
              if (err) return res.status(500).json({ error: err.message })
              res.json({ week, closed_at: closedAt || null, scores: scores || [] })
            },
          )
        })
      },
    )
  },
)

module.exports = router
