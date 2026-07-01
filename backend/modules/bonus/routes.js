const express = require("express")
const xlsx = require("xlsx")
const ExcelJS = require("exceljs")
const JSZip = require("jszip")
const db = require("../../db")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

const time = require("../../utils/time")
const { mapSqliteError, get, all, run, withTransaction } = require("../../utils/dbp")

const router = express.Router()

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

function parseDateVN(text) {
  const m = String(text || "").match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm}-${dd}`
}

function parseClassName(text) {
  const m = String(text || "").match(/Lớp:\s*([0-9]{2}A[0-9]{1,2})/i)
  if (!m) return null
  return m[1].toUpperCase()
}

function isValidClassName(name) {
  return /^[0-9]{2}A[0-9]{1,2}$/i.test(String(name || "").trim())
}

function normalizeSession(text) {
  const s = String(text || "").trim().toLowerCase()
  if (!s) return null
  if (s.includes("sáng") || s.includes("sang")) return "Sáng"
  if (s.includes("chiều") || s.includes("chieu")) return "Chiều"
  return null
}

function isIgnoredSubject(text) {
  const s = String(text || "").trim().toLowerCase()
  if (!s) return false
  return (
    s === "giáo dục thể chất" ||
    s === "giao duc the chat" ||
    s === "thể dục" ||
    s === "the duc" ||
    s === "gdtc"
  )
}

function gradeFromClassName(name) {
  const g = parseInt(String(name || "").slice(0, 2), 10)
  return Number.isFinite(g) ? g : null
}

function isAutoChaoCoByRule(className, dayNum, session, periodNo) {
  return false
}

function dayNumberFromISO(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number)
  if (!y || !m || !d) return null
  const dow = new Date(y, m - 1, d).getDay() // 0 Sun .. 6 Sat
  if (dow === 0) return null
  return dow + 1 // Mon=2 .. Sat=7
}

function dayNameFromNumber(dayNum) {
  const map = {
    1: "Chủ Nhật",
    2: "Thứ Hai",
    3: "Thứ Ba",
    4: "Thứ Tư",
    5: "Thứ Năm",
    6: "Thứ Sáu",
    7: "Thứ Bảy",
  }
  return map[dayNum] || ""
}

function toNumber(val) {
  if (val == null) return null
  if (typeof val === "number") return Number.isFinite(val) ? val : null
  const s = String(val).trim().replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function formatDateVN(iso) {
  if (!iso) return ""
  const parts = String(iso).split("-")
  if (parts.length !== 3) return ""
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function cell(sheet, addr) {
  const c = sheet[addr]
  return c ? c.v : null
}

function parseSoDauBaiBuffer(buf) {
  const workbook = xlsx.read(buf, { type: "buffer" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error("No sheet")

  const className = parseClassName(cell(sheet, "K20")) || null
  const days = []
  const allScores = []

  for (let r = 1; r <= 2000; r++) {
    const a = cell(sheet, `A${r}`)
    const iso = parseDateVN(a)
    if (!iso) continue

    const periods = []
    let currentSession = null
    for (let i = 0; i < 10; i++) {
      const rowIndex = r + i
      const sessionRaw = cell(sheet, `C${rowIndex}`)
      const session = normalizeSession(sessionRaw) || currentSession
      if (session) currentSession = session
      const periodNum = toNumber(cell(sheet, `D${rowIndex}`))
      const subjectRaw =
        cell(sheet, `E${rowIndex}`) ??
        cell(sheet, `F${rowIndex}`) ??
        cell(sheet, `G${rowIndex}`) ??
        ""
      if (isIgnoredSubject(subjectRaw)) {
        continue
      }

      const v = cell(sheet, `U${rowIndex}`)
      const n = toNumber(v)
      if (periodNum != null) {
        periods.push({
          subject: String(subjectRaw || "").trim() || "Tiết",
          score: n,
          period: periodNum,
          session,
        })
        if (n != null) {
          allScores.push(n)
        }
      }
    }

    const scores = periods.map((p) => p.score).filter((x) => x != null)
    const total = scores.reduce((s, x) => s + x, 0)
    const minScore = scores.length ? Math.min(...scores) : null
    const allAbove9 = scores.length ? scores.every((x) => x >= 9) : false

    days.push({
      date: iso,
      total_points: total,
      min_score: minScore,
      all_above_9: allAbove9,
      periods,
      raw: String(a || ""),
    })

    r += 9
  }

  days.sort((x, y) => x.date.localeCompare(y.date))

  const file_all_above_9 =
    allScores.length > 0 && allScores.every((x) => x >= 9)

  return {
    class_name: className,
    days,
    file_all_above_9,
  }
}

function parseTimetableBuffer(buf) {
  const workbook = xlsx.read(buf, { type: "buffer" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error("No sheet")

  const applyCell =
    cell(sheet, "I5") ?? cell(sheet, "J5") ?? cell(sheet, "K5") ?? cell(sheet, "L5")
  const effectiveDate = parseDateVN(applyCell)
  if (!effectiveDate) throw new Error("Missing effective date")

  const entries = []
  let lastClass = null
  let lastSession = null
  let emptyRowCount = 0

  for (let r = 10; r <= 2000; r++) {
    const classRaw = cell(sheet, `A${r}`)
    const classCandidate = String(classRaw || "").trim().toUpperCase()
    if (classCandidate) {
      if (isValidClassName(classCandidate)) {
        lastClass = classCandidate
      } else {
        lastClass = null
      }
    }

    const sessionRaw = cell(sheet, `B${r}`)
    const session = normalizeSession(sessionRaw) || lastSession
    if (session) lastSession = session

    const periodNum = toNumber(cell(sheet, `C${r}`))

    if (!lastClass && !session && !periodNum) {
      emptyRowCount += 1
      if (emptyRowCount > 20) break
      continue
    }
    emptyRowCount = 0

    if (!lastClass || !session || periodNum == null) {
      continue
    }

    const dayCols = [
      { col: "D", day: 2 },
      { col: "E", day: 3 },
      { col: "F", day: 4 },
      { col: "G", day: 5 },
      { col: "H", day: 6 },
      { col: "I", day: 7 },
    ]

    for (const d of dayCols) {
      const subjectRaw = cell(sheet, `${d.col}${r}`)
      const subject = String(subjectRaw || "").trim()
      if (!subject) continue
      entries.push({
        class_name: lastClass,
        day_of_week: d.day,
        session,
        period: Number(periodNum),
        subject,
      })
    }
  }

  return { effective_date: effectiveDate, entries }
}

/*
ADMIN: parse a "so dau bai" excel
body: { file_data: base64, file_name?: string }
output: { days: [{date,total_points,periods,raw}], weekly_all_above_9 }
*/
router.post(
  "/parse",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const { file_data } = req.body
    if (!file_data) return res.status(400).json({ error: "Missing file" })

    let buf
    try {
      buf = Buffer.from(String(file_data), "base64")
    } catch {
      return res.status(400).json({ error: "Invalid file" })
    }

    let out
    try {
      out = parseSoDauBaiBuffer(buf)
    } catch {
      return res.status(400).json({ error: "Invalid excel" })
    }

    res.json({
      class_name: out.class_name,
      days: out.days,
      file_all_above_9: out.file_all_above_9,
    })
  },
)

/*
ADMIN: upload timetable excel (whole school)
body: { file_data: base64, file_name? }
*/
router.post(
  "/admin/upload-timetable",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const { file_data } = req.body
    const fileName = String(req.body.file_name || "timetable.xlsx").trim()
    if (!file_data) return res.status(400).json({ error: "Missing file" })

    let buf
    try {
      buf = Buffer.from(String(file_data), "base64")
    } catch {
      return res.status(400).json({ error: "Invalid file" })
    }

    let parsed
    try {
      parsed = parseTimetableBuffer(buf)
    } catch (err) {
      return res.status(400).json({ error: "Invalid timetable" })
    }

    const effectiveDate = parsed.effective_date
    const entries = parsed.entries || []
    const now = time.now()

    try {
      const timetableId = await withTransaction(async () => {
        const out = await run(
          `
            INSERT INTO timetables (effective_date, file_name, created_at)
            VALUES(?,?,?)
          `,
          [effectiveDate, fileName, now],
        )
        const id = out.lastID

        for (const e of entries) {
          await run(
            `
              INSERT INTO timetable_entries
              (timetable_id, class_name, day_of_week, session, period, subject)
              VALUES(?,?,?,?,?,?)
            `,
            [id, e.class_name, e.day_of_week, e.session, e.period, e.subject],
          )
        }

        return id
      })

      res.json({
        success: true,
        timetable_id: timetableId,
        effective_date: effectiveDate,
        entry_count: entries.length,
      })
    } catch (err) {
      const out = mapSqliteError(err, err?.message || "DB error")
      res.status(out.status).json({ error: out.error })
    }
  },
)

/*
ADMIN: list timetables
*/
router.get(
  "/admin/timetables",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const rows = await all(
        `
          SELECT id, effective_date, file_name, created_at
          FROM timetables
          ORDER BY effective_date DESC, id DESC
        `,
      )
      res.json({ timetables: rows || [] })
    } catch (err) {
      res.status(500).json({ error: err?.message || "DB error" })
    }
  },
)

/*
ADMIN: timetable lookup by class
query: class_name
*/
router.get(
  "/admin/timetable/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const timetableId = Number(req.params.id)
    const className = String(req.query.class_name || "").trim().toUpperCase()
    if (!timetableId || !className) {
      return res.status(400).json({ error: "Missing fields" })
    }
    try {
      const meta = await get(
        `SELECT id, effective_date, file_name FROM timetables WHERE id=? LIMIT 1`,
        [timetableId],
      )
      if (!meta) return res.status(404).json({ error: "Timetable not found" })

      const rows = await all(
        `
          SELECT day_of_week, session, period, subject
          FROM timetable_entries
          WHERE timetable_id=?
            AND class_name=?
          ORDER BY day_of_week ASC, session ASC, period ASC
        `,
        [timetableId, className],
      )
      res.json({ timetable: meta, class_name: className, entries: rows || [] })
    } catch (err) {
      res.status(500).json({ error: err?.message || "DB error" })
    }
  },
)

/*
ADMIN: upload a zip of so_dau_bai files for a grade in a week
body: { week_id, grade, file_data: base64, file_name? }
*/
router.post(
  "/admin/upload-zip",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const weekId = Number(req.body.week_id)
      const grade = String(req.body.grade || "").trim()
      const fileName = String(req.body.file_name || "upload.zip").trim()
      const { file_data } = req.body

      if (!weekId || !grade || !file_data) {
        return res.status(400).json({ error: "Missing fields" })
      }
      if (!["10", "11", "12"].includes(grade)) {
        return res.status(400).json({ error: "Invalid grade" })
      }

      let buf
      try {
        buf = Buffer.from(String(file_data), "base64")
      } catch {
        return res.status(400).json({ error: "Invalid file" })
      }

      const week = await get(
        `SELECT id, start_date, end_date FROM schedule_weeks WHERE id=? LIMIT 1`,
        [weekId],
      )
      if (!week) return res.status(404).json({ error: "Week not found" })

      const [closed] = await new Promise((resolve, reject) => {
        isWeekClosed(weekId, (err, isClosed) => {
          if (err) return reject(err)
          resolve([isClosed])
        })
      })
      if (closed) return res.status(403).json({ error: "Week closed" })

      const timetableHeaders = await all(
        `SELECT id, effective_date FROM timetables ORDER BY effective_date ASC, id ASC`,
      )
      const timetableCache = new Map()

      async function getTimetableMap(dateIso) {
        if (!timetableHeaders.length) return null
        let chosen = null
        for (const h of timetableHeaders) {
          if (h.effective_date <= dateIso) {
            chosen = h
          } else {
            break
          }
        }
        if (!chosen) return null
        if (timetableCache.has(chosen.id)) return timetableCache.get(chosen.id)

        const rows = await all(
          `
            SELECT class_name, day_of_week, session, period, subject
            FROM timetable_entries
            WHERE timetable_id=?
          `,
          [chosen.id],
        )
        const map = new Map()
        for (const r of rows || []) {
          const className = String(r.class_name || "").toUpperCase()
          const day = Number(r.day_of_week)
          const session = normalizeSession(r.session)
          const period = Number(r.period)
          if (!className || !day || !session || !period) continue
          if (!map.has(className)) map.set(className, new Map())
          const dayMap = map.get(className)
          if (!dayMap.has(day)) dayMap.set(day, new Map())
          const sessionMap = dayMap.get(day)
          if (!sessionMap.has(session)) sessionMap.set(session, new Map())
          const periodMap = sessionMap.get(session)
          periodMap.set(period, String(r.subject || "").trim())
        }
        timetableCache.set(chosen.id, map)
        return map
      }

      let zip
      try {
        zip = await JSZip.loadAsync(buf)
      } catch {
        return res.status(400).json({ error: "Invalid zip" })
      }

    const entries = Object.values(zip.files || {})
    const xlsxFiles = entries.filter((f) => {
      if (f.dir) return false
      const name = String(f.name || "").toLowerCase()
      return name.endsWith(".xlsx") || name.endsWith(".xls")
    })

      if (xlsxFiles.length === 0) {
        return res.status(400).json({ error: "No xlsx files found" })
      }

    let appliedDays = 0
    let processedFiles = 0
    let skippedFiles = 0
    const appliedClasses = new Set()
    const errors = []
        const missingLogs = []

      await withTransaction(async () => {
        for (const f of xlsxFiles) {
          processedFiles += 1
        let fileBuf
        try {
          fileBuf = await f.async("nodebuffer")
        } catch {
          skippedFiles += 1
          errors.push({ file: f.name, error: "Cannot read file" })
          continue
        }

        let parsed
        try {
          parsed = parseSoDauBaiBuffer(fileBuf)
        } catch {
          skippedFiles += 1
          errors.push({ file: f.name, error: "Invalid excel" })
          continue
        }

        const className = parsed.class_name
        if (!className || !String(className).startsWith(`${grade}A`) || !isValidClassName(className)) {
          skippedFiles += 1
          continue
        }

        appliedClasses.add(className)
        for (const day of parsed.days || []) {
          if (!(week.start_date <= day.date && day.date <= week.end_date)) {
            continue
          }
          const dayNum = dayNumberFromISO(day.date)
          if (!dayNum) continue

          const timetable = await getTimetableMap(day.date)
          const classMap = timetable?.get(String(className).toUpperCase()) || null

        const periodRows = Array.isArray(day.periods) ? day.periods : []
        const sdbMap = new Map()
        for (const p of periodRows) {
          const session = normalizeSession(p.session) || null
          const periodNo = Number(p.period)
          if (!session || !Number.isFinite(periodNo)) continue
          if (isIgnoredSubject(p.subject)) continue
          if (!sdbMap.has(session)) sdbMap.set(session, new Map())
          const sessionMap = sdbMap.get(session)
          if (!sessionMap.has(periodNo)) {
            sessionMap.set(periodNo, {
              subject: String(p.subject || "").trim(),
              score: toNumber(p.score),
            })
          }
        }

        const usable = []
        if (classMap) {
          const dayMap = classMap.get(dayNum)
          if (dayMap) {
            for (const [session, periodMap] of dayMap.entries()) {
              for (const [periodNo, subjectTk] of periodMap.entries()) {
                if (isAutoChaoCoByRule(className, dayNum, session, periodNo)) {
                  continue
                }
                if (isIgnoredSubject(subjectTk)) continue

                const sdb = sdbMap.get(session)?.get(periodNo)
                if (sdb && sdb.score != null) {
                  let score = sdb.score
                  if (score > 10) {
                    const ddmmyy = formatDateVN(day.date)
                    const dayName = dayNameFromNumber(dayNum)
                  const sessLabel = session.toLowerCase() === "sáng" ? "Sáng" : "Chiều"
                  missingLogs.push({
                      grade: gradeFromClassName(className),
                      class_name: className,
                      day_name: dayName,
                      date: ddmmyy,
                      period: periodNo,
                      subject: subjectTk,
                      session: sessLabel,
                      status: `Nhập sổ đầu bài không hợp lệ (${score} điểm)`,
                    })
                    score = 10
                  }
                  usable.push({
                    subject: sdb.subject || subjectTk,
                    score,
                  })
                  continue
                }

                const ddmmyy = formatDateVN(day.date)
                const dayName = dayNameFromNumber(dayNum)
                const sessLabel = session.toLowerCase() === "sáng" ? "Sáng" : "Chiều"
                missingLogs.push({
                  grade: gradeFromClassName(className),
                  class_name: className,
                  day_name: dayName,
                  date: ddmmyy,
                  period: periodNo,
                  subject: subjectTk,
                  session: sessLabel,
                  status: "Chưa nhập sổ đầu bài",
                })
                usable.push({
                  subject: subjectTk,
                  score: 10,
                })
              }
            }
          }
        } else {
          for (const [session, periodMap] of sdbMap.entries()) {
            for (const [periodNo, sdb] of periodMap.entries()) {
              let score = sdb.score ?? 10
              const ddmmyy = formatDateVN(day.date)
              const dayName = dayNameFromNumber(dayNum)
              const sessLabel = session.toLowerCase() === "sáng" ? "Sáng" : "Chiều"
              if (sdb.score == null) {
                missingLogs.push({
                  grade: gradeFromClassName(className),
                  class_name: className,
                  day_name: dayName,
                  date: ddmmyy,
                  period: periodNo,
                  subject: sdb.subject || "Tiết",
                  session: sessLabel,
                  status: "Chưa nhập sổ đầu bài",
                })
              } else if (score > 10) {
                missingLogs.push({
                  grade: gradeFromClassName(className),
                  class_name: className,
                  day_name: dayName,
                  date: ddmmyy,
                  period: periodNo,
                  subject: sdb.subject || "Tiết",
                  session: sessLabel,
                  status: `Nhập sổ đầu bài không hợp lệ (${score} điểm)`,
                })
                score = 10
              }
              usable.push({
                subject: sdb.subject || "Tiết",
                score,
              })
            }
          }
        }

          if (usable.length === 0) {
            await run(
              `DELETE FROM daily_bonus WHERE week_id=? AND date=? AND class_name=?`,
              [weekId, day.date, className],
            )
            continue
          }

          const scores = usable.map((x) => x.score)
          const totalPoints = scores.reduce((s, x) => s + x, 0)
          const minScore = scores.length ? Math.min(...scores) : null
          const allAbove9 = scores.length ? scores.every((x) => x >= 9) : false

          const sess = await get(
            `SELECT id FROM duty_sessions WHERE week_id=? AND duty_class=? AND date=? LIMIT 1`,
            [weekId, className, day.date],
          )
          const sessionId = sess?.id || null
          const now = time.now()

            await run(
            `
              INSERT INTO daily_bonus
              (session_id,week_id,date,class_name,points,min_score,all_above_9,source,periods_json,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(week_id,date,class_name)
              DO UPDATE SET
                session_id=excluded.session_id,
                points=excluded.points,
                min_score=excluded.min_score,
                all_above_9=excluded.all_above_9,
                source=excluded.source,
                periods_json=excluded.periods_json,
                updated_at=excluded.updated_at
            `,
            [
              sessionId,
              weekId,
              day.date,
              className,
              totalPoints,
              minScore,
              allAbove9 ? 1 : 0,
              fileName,
              JSON.stringify(usable || []),
              now,
              now,
            ],
          )
          appliedDays += 1
        }
      }

      for (const className of Array.from(appliedClasses)) {
        const row = await get(
          `
            SELECT
              COUNT(*) as bonus_count,
              SUM(CASE WHEN min_score >= 9 THEN 1 ELSE 0 END) as ok_count
            FROM daily_bonus
            WHERE week_id=?
              AND class_name=?
          `,
          [weekId, className],
        )
        const bonusCount = Number(row?.bonus_count || 0)
        const okCount = Number(row?.ok_count || 0)
        const eligible = bonusCount > 0 && okCount === bonusCount

        const now = time.now()
        if (eligible) {
          await run(
            `
              INSERT INTO weekly_bonus (week_id,class_name,points,reason,created_at,updated_at)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(week_id,class_name)
              DO UPDATE SET
                points=excluded.points,
                reason=excluded.reason,
                updated_at=excluded.updated_at
            `,
            [weekId, className, 30, "Thuong tu so dau bai: tat ca tiet >= 9", now, now],
          )
        } else {
          await run(
            `DELETE FROM weekly_bonus WHERE week_id=? AND class_name=? AND points=30`,
            [weekId, className],
          )
        }
      }

      await run(
        `
          INSERT INTO bonus_uploads (week_id, grade, file_name, xlsx_count, uploaded_at)
          VALUES(?,?,?,?,?)
        `,
        [weekId, grade, fileName, xlsxFiles.length, time.now()],
        )
      })

      res.json({
        week_id: weekId,
        grade,
        processed_files: processedFiles,
        skipped_files: skippedFiles,
        applied_days: appliedDays,
        classes: Array.from(appliedClasses),
        missing_logs: missingLogs,
        errors,
      })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err?.message || "Upload error" })
    }
  },
)

/*
ADMIN: export missing logs to Excel
body: { week_id, logs }
*/
router.post(
  "/admin/missing-logs/export",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const weekId = Number(req.body.week_id)
    const gradeFilter = Number(req.body.grade || 0) || null
    const logs = Array.isArray(req.body.logs) ? req.body.logs : []

    const week =
      weekId > 0
        ? await get(`SELECT week_number, start_date, end_date FROM schedule_weeks WHERE id=?`, [
            weekId,
          ])
        : null

    const workbook = new ExcelJS.Workbook()
    const sheetName = gradeFilter ? `Khoi ${gradeFilter}` : "Khoi"
    const ws = workbook.addWorksheet(sheetName)

    const baseFont = { name: "Times New Roman", size: 12 }

    function parseClass(name) {
      const g = parseInt(String(name || ""), 10) || 0
      const aPos = String(name || "").indexOf("A")
      const num =
        aPos >= 0 ? parseInt(String(name || "").slice(aPos + 1), 10) || 0 : 0
      return { g, num }
    }

    const rows = logs
      .map((r) => {
        const className = String(r.class_name || "").trim()
        const grade = Number(r.grade || gradeFromClassName(className) || 0)
        const dayName = String(r.day_name || "")
        const date = String(r.date || "")
        const period = Number(r.period || 0)
        const subject = String(r.subject || "")
        const session = String(r.session || "")
        const status = String(r.status || "Chưa nhập sổ đầu bài")
        return { grade, className, dayName, date, period, subject, session, status }
      })
      .filter((r) => (gradeFilter ? r.grade === gradeFilter : true))
      .filter((r) => r.className)
      .sort((a, b) => {
        if (a.grade !== b.grade) return a.grade - b.grade
        const aa = parseClass(a.className)
        const bb = parseClass(b.className)
        if (aa.num !== bb.num) return aa.num - bb.num
        if (a.className !== b.className) return a.className.localeCompare(b.className)
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        if (a.session !== b.session) return a.session.localeCompare(b.session)
        return a.period - b.period
      })

    const titleWeek = week
      ? `TUẦN ${week.week_number} (${formatDateVN(week.start_date)} - ${formatDateVN(
          week.end_date,
        )})`
      : "TUẦN"

    ws.mergeCells("A1:H1")
    ws.getCell("A1").value = `DANH SÁCH CÁC TIẾT CHƯA NHẬP SỔ ĐẦU BÀI ${titleWeek}`
    ws.getCell("A1").font = { ...baseFont, bold: true }
    ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }

    ws.getRow(2).values = [
      "Khối",
      "Lớp",
      "Thứ",
      "Ngày",
      "Tiết",
      "Môn học",
      "Buổi",
      "Trạng thái",
    ]
    ws.getRow(2).font = { ...baseFont, bold: true }

    let rowIndex = 3
    function normalizeDayName(name) {
      const n = String(name || "").trim()
      if (!n) return ""
      if (n.toLowerCase().startsWith("thứ") || n.toLowerCase().startsWith("chủ")) return n
      return `Thứ ${n}`
    }

    function normalizeSessionName(name) {
      const n = String(name || "").trim().toLowerCase()
      if (n === "sáng") return "Sáng"
      if (n === "chiều") return "Chiều"
      return name
    }

    rows.forEach((r, idx) => {
      const row = ws.getRow(rowIndex++)
      const prev = rows[idx - 1]
      row.getCell(1).value = r.grade && (!prev || prev.grade !== r.grade) ? `${r.grade}` : ""
      row.getCell(2).value = r.className
      row.getCell(3).value = normalizeDayName(r.dayName)
      row.getCell(4).value = r.date
      row.getCell(5).value = r.period || ""
      row.getCell(6).value = r.subject
      row.getCell(7).value = normalizeSessionName(r.session)
      row.getCell(8).value = r.status || "Chưa nhập sổ đầu bài"
    })

    // Merge grade cells in column A
    let startIndex = 0
    let startRow = 3
    for (let i = 0; i < rows.length; i += 1) {
      const cur = rows[i]
      const next = rows[i + 1]
      if (!next || next.grade !== cur.grade) {
        const endRow = 3 + i
        if (endRow > startRow) ws.mergeCells(`A${startRow}:A${endRow}`)
        startIndex = i + 1
        startRow = 3 + startIndex
      }
    }

    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell((cell) => {
        if (!cell.font) cell.font = { ...baseFont }
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
        cell.border = {
          top: { style: "thin", color: { argb: "FF000000" } },
          left: { style: "thin", color: { argb: "FF000000" } },
          bottom: { style: "thin", color: { argb: "FF000000" } },
          right: { style: "thin", color: { argb: "FF000000" } },
        }
      })
    })

    ws.columns = [
      { width: 12 },
      { width: 12 },
      { width: 10 },
      { width: 14 },
      { width: 8 },
      { width: 26 },
      { width: 12 },
      { width: 36 },
    ]

    const buf = await workbook.xlsx.writeBuffer()
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    const fileGrade = gradeFilter ? `${gradeFilter}` : "xx"
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"TrangThaiSDBK${fileGrade}.xlsx\"`,
    )
    res.send(Buffer.from(buf))
  },
)

/*
ADMIN: upload status for a week (per grade)
query: week_id
*/
router.get(
  "/admin/upload-status",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const weekId = Number(req.query.week_id)
    if (!weekId) return res.status(400).json({ error: "Missing week_id" })

    const rows = await all(
      `
        SELECT grade, COUNT(*) as upload_count, MAX(uploaded_at) as last_uploaded
        FROM bonus_uploads
        WHERE week_id=?
        GROUP BY grade
      `,
      [weekId],
    )

    res.json({ week_id: weekId, grades: rows || [] })
  },
)
/*
ADMIN: apply a day bonus to a class in a week (only within week range)
body: { week_id, class_name, date, points, min_score?, all_above_9?, source, session_id? }
*/
router.post(
  "/apply-day",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.body.week_id)
    const className = String(req.body.class_name || "").trim()
    const date = String(req.body.date || "").trim()
    const points = Number(req.body.points)
    const minScore = req.body.min_score == null ? null : Number(req.body.min_score)
    const allAbove9 = req.body.all_above_9 ? 1 : 0
    const source = String(req.body.source || "so_dau_bai").trim()
    const sessionId = req.body.session_id ? Number(req.body.session_id) : null
    const rawPeriods = Array.isArray(req.body.periods) ? req.body.periods : null
    const normalizedPeriods = rawPeriods
      ? rawPeriods
          .map((p) => {
            if (p && typeof p === "object") {
              const score = Number(p.score)
              if (!Number.isFinite(score)) return null
              const subject = String(p.subject || "").trim() || "Tiết"
              return { subject, score }
            }
            const score = Number(p)
            if (!Number.isFinite(score)) return null
            return { subject: "Tiết", score }
          })
          .filter(Boolean)
      : null
    const hasPeriods = Array.isArray(normalizedPeriods) && normalizedPeriods.length > 0
    const periodsJson = hasPeriods ? JSON.stringify(normalizedPeriods) : null

    if (!weekId || !className || !date || !Number.isFinite(points)) {
      return res.status(400).json({ error: "Missing fields" })
    }

    db.get(
      `SELECT start_date,end_date FROM schedule_weeks WHERE id=? LIMIT 1`,
      [weekId],
      (err, week) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!week) return res.status(404).json({ error: "Week not found" })

        if (!(week.start_date <= date && date <= week.end_date)) {
          return res.status(400).json({ error: "Date out of week" })
        }

        const now = time.now()
        const finalizeWeeklyBonus = () => {
          db.get(
            `
              SELECT
                COUNT(*) as bonus_count,
                SUM(CASE WHEN min_score >= 9 THEN 1 ELSE 0 END) as ok_count
              FROM daily_bonus
              WHERE week_id=?
                AND class_name=?
            `,
            [weekId, className],
            (err2, row2) => {
              if (err2) return res.status(500).json({ error: err2.message })
              const bonusCount = Number(row2?.bonus_count || 0)
              const okCount = Number(row2?.ok_count || 0)
              const eligible = bonusCount > 0 && okCount === bonusCount

              db.get(
                `SELECT points FROM weekly_bonus WHERE week_id=? AND class_name=? LIMIT 1`,
                [weekId, className],
                (err3, existingBonus) => {
                  if (err3) return res.status(500).json({ error: err3.message })

                  if (eligible && !existingBonus) {
                    db.run(
                      `
                        INSERT INTO weekly_bonus
                        (week_id,class_name,points,reason,created_at,updated_at)
                        VALUES(?,?,?,?,?,?)
                      `,
                      [
                        weekId,
                        className,
                        30,
                        "Thuong tu so dau bai: tat ca tiet >= 9",
                        now,
                        now,
                      ],
                      (err4) => {
                        if (err4) return res.status(500).json({ error: err4.message })
                        res.json({ success: true, eligible })
                      },
                    )
                    return
                  }

                  if (!eligible && existingBonus && existingBonus.points === 30) {
                    db.run(
                      `DELETE FROM weekly_bonus WHERE week_id=? AND class_name=? AND points=30`,
                      [weekId, className],
                      (err4) => {
                        if (err4) return res.status(500).json({ error: err4.message })
                        res.json({ success: true, eligible })
                      },
                    )
                    return
                  }

                  res.json({ success: true, eligible })
                },
              )
            },
          )
        }

        if (!hasPeriods) {
          return db.run(
            `DELETE FROM daily_bonus WHERE week_id=? AND date=? AND class_name=?`,
            [weekId, date, className],
            (err) => {
              if (err) {
                const out = mapSqliteError(err, err.message)
                return res.status(out.status).json({ error: out.error })
              }
              finalizeWeeklyBonus()
            },
          )
        }

        db.run(
          `
            INSERT INTO daily_bonus
            (session_id,week_id,date,class_name,points,min_score,all_above_9,source,periods_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(week_id,date,class_name)
            DO UPDATE SET
              session_id=excluded.session_id,
              points=excluded.points,
              min_score=excluded.min_score,
              all_above_9=excluded.all_above_9,
              source=excluded.source,
              periods_json=excluded.periods_json,
              updated_at=excluded.updated_at
          `,
          [
            sessionId,
            weekId,
            date,
            className,
            points,
            minScore,
            allAbove9,
            source,
            periodsJson,
            now,
            now,
          ],
          (err) => {
            if (err) {
              const out = mapSqliteError(err, err.message)
              return res.status(out.status).json({ error: out.error })
            }
            finalizeWeeklyBonus()
          },
        )
      },
    )
  },
)

/*
ADMIN: eligibility for +30 weekly bonus based on applied days within the duty week.
Rule: considering ONLY days that have been applied into daily_bonus for (week_id,class_name):
eligible if count>0 AND all days have all_above_9=1.
*/
router.get(
  "/eligibility",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.query.week_id)
    const className = String(req.query.class_name || "").trim()
    if (!weekId || !className) return res.status(400).json({ error: "Missing fields" })

    db.get(
      `
        SELECT
          COUNT(*) as day_count,
          SUM(CASE WHEN all_above_9=1 THEN 1 ELSE 0 END) as ok_count
        FROM daily_bonus
        WHERE week_id=?
          AND class_name=?
      `,
      [weekId, className],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        const dayCount = Number(row?.day_count || 0)
        const okCount = Number(row?.ok_count || 0)
        res.json({
          week_id: weekId,
          class_name: className,
          day_count: dayCount,
          eligible: dayCount > 0 && okCount === dayCount,
        })
      },
    )
  },
)

/*
CO_DO: weekly +30 eligibility based on daily_bonus applied to each duty session day.
Rule: For the duty_class assigned to this red_class in the week, eligible if:
- there is at least 1 session in the week
- every session date has a daily_bonus row
- and min_score >= 9 for every date (meaning every period score that day >= 9)
query: week_id
*/
router.get(
  "/co_do/eligibility",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {
    const weekId = Number(req.query.week_id)
    if (!weekId) return res.status(400).json({ error: "Missing week_id" })

    const redClass = req.session.user?.class_name

    db.get(
      `
        SELECT duty_class
        FROM schedule_assignments
        WHERE week_id=?
          AND red_class=?
        LIMIT 1
      `,
      [weekId, redClass],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        const dutyClass = row?.duty_class
        if (!dutyClass) {
          return res.json({
            week_id: weekId,
            eligible: false,
            session_count: 0,
            ok_count: 0,
            missing_count: 0,
            min_score: null,
          })
        }

        db.get(
          `
            SELECT
              COUNT(*) as session_count,
              SUM(CASE WHEN b.min_score IS NOT NULL THEN 1 ELSE 0 END) as bonus_count,
              SUM(CASE WHEN b.min_score >= 9 THEN 1 ELSE 0 END) as ok_count,
              MIN(COALESCE(b.min_score, -1)) as min_of_min
            FROM duty_sessions s
            LEFT JOIN daily_bonus b
              ON b.week_id = s.week_id
             AND b.date = s.date
             AND b.class_name = s.duty_class
            WHERE s.week_id=?
              AND s.duty_class=?
          `,
          [weekId, dutyClass],
          (err2, row2) => {
            if (err2) return res.status(500).json({ error: err2.message })

            const sessionCount = Number(row2?.session_count || 0)
            const bonusCount = Number(row2?.bonus_count || 0)
            const okCount = Number(row2?.ok_count || 0)
            const missingCount = Math.max(0, sessionCount - bonusCount)
            const minOfMin = Number(row2?.min_of_min ?? -1)

            const eligible = bonusCount > 0 && okCount === bonusCount

            res.json({
              week_id: weekId,
              eligible,
              session_count: sessionCount,
              ok_count: okCount,
              missing_count: missingCount,
              min_score: sessionCount > 0 ? minOfMin : null,
            })
          },
        )
      },
    )
  },
)

/*
CO_DO: apply +30 weekly bonus for the duty class assigned to this red_class in a week.
Server-side verifies eligibility, so the client cannot spoof it.
body: { week_id }
*/
router.post(
  "/co_do/apply-week-30",
  requireLogin,
  requireRole(["co_do"]),
  (req, res) => {
    const weekId = Number(req.body.week_id)
    if (!weekId) return res.status(400).json({ error: "Missing week_id" })

    const redClass = req.session.user?.class_name

    isWeekClosed(weekId, (err, closed) => {
      if (err) return res.status(500).json({ error: err.message })
      if (closed) return res.status(403).json({ error: "Week closed" })

      db.get(
        `
          SELECT duty_class
          FROM schedule_assignments
          WHERE week_id=?
            AND red_class=?
          LIMIT 1
        `,
        [weekId, redClass],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message })
          const className = row?.duty_class ? String(row.duty_class).trim() : ""
          if (!className) {
            return res.json({
              week_id: weekId,
              eligible: false,
              applied: false,
              reason: "No assignment",
              session_count: 0,
              ok_count: 0,
              missing_count: 0,
              min_score: null,
            })
          }

          db.get(
            `
              SELECT
                COUNT(*) as session_count,
                SUM(CASE WHEN b.min_score IS NOT NULL THEN 1 ELSE 0 END) as bonus_count,
                SUM(CASE WHEN b.min_score >= 9 THEN 1 ELSE 0 END) as ok_count,
                MIN(COALESCE(b.min_score, -1)) as min_of_min
              FROM duty_sessions s
              LEFT JOIN daily_bonus b
                ON b.week_id = s.week_id
               AND b.date = s.date
               AND b.class_name = s.duty_class
              WHERE s.week_id=?
                AND s.duty_class=?
            `,
            [weekId, className],
            (err2, row2) => {
              if (err2) return res.status(500).json({ error: err2.message })

              const sessionCount = Number(row2?.session_count || 0)
              const bonusCount = Number(row2?.bonus_count || 0)
              const okCount = Number(row2?.ok_count || 0)
              const missingCount = Math.max(0, sessionCount - bonusCount)
              const minOfMin = Number(row2?.min_of_min ?? -1)

            const eligible = bonusCount > 0 && okCount === bonusCount

              if (!eligible) {
                return res.json({
                  week_id: weekId,
                  class_name: className,
                  eligible: false,
                  applied: false,
                  reason: okCount < bonusCount ? "Has periods below 9" : "No daily bonus data",
                  session_count: sessionCount,
                  ok_count: okCount,
                  missing_count: missingCount,
                  min_score: sessionCount > 0 ? minOfMin : null,
                })
              }

              const now = time.now()
              db.run(
                `
                  INSERT INTO weekly_bonus
                  (week_id,class_name,points,reason,created_at,updated_at)
                  VALUES(?,?,?,?,?,?)
                  ON CONFLICT(week_id,class_name)
                  DO UPDATE SET
                    points=excluded.points,
                    reason=excluded.reason,
                    updated_at=excluded.updated_at
                `,
                [
                  weekId,
                  className,
                  30,
                  "Thuong tu so dau bai: tat ca tiet >= 9",
                  now,
                  now,
                ],
                (err) => {
                  if (err) return res.status(500).json({ error: err.message })
                  res.json({
                    week_id: weekId,
                    class_name: className,
                    eligible: true,
                    applied: true,
                    points: 30,
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

/*
ADMIN: apply weekly bonus (e.g. +30 if all >9)
body: { week_id, class_name, points, reason }
*/
router.post(
  "/apply-week",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const weekId = Number(req.body.week_id)
    const className = String(req.body.class_name || "").trim()
    const points = Number(req.body.points)
    const reason = String(req.body.reason || "").trim()

    if (!weekId || !className || !Number.isFinite(points)) {
      return res.status(400).json({ error: "Missing fields" })
    }

    const now = time.now()
    db.run(
      `
        INSERT INTO weekly_bonus
        (week_id,class_name,points,reason,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(week_id,class_name)
        DO UPDATE SET
          points=excluded.points,
          reason=excluded.reason,
          updated_at=excluded.updated_at
      `,
      [weekId, className, points, reason, now, now],
      (err) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ success: true })
      },
    )
  },
)

/*
CO_DO: apply a day bonus for the duty_class of a session (smart/secure)
body: { session_id, date, points, min_score?, all_above_9?, source, class_name? }
*/
router.post(
  "/co_do/apply-day",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const sessionId = Number(req.body.session_id)
    const date = String(req.body.date || "").trim()
    const points = Number(req.body.points)
    const minScore = req.body.min_score == null ? null : Number(req.body.min_score)
    const allAbove9 = req.body.all_above_9 ? 1 : 0
    const source = String(req.body.source || "so_dau_bai").trim()
    const claimedClass = req.body.class_name ? String(req.body.class_name).trim() : null

    if (!sessionId || !date || !Number.isFinite(points)) {
      return res.status(400).json({ error: "Missing fields" })
    }

    const redClass = req.session.user?.class_name

    db.get(
      `
        SELECT s.id, s.week_id, s.red_class, s.duty_class, s.date
        FROM duty_sessions s
        JOIN schedule_assignments a
          ON a.week_id = s.week_id
         AND a.red_class = ?
         AND a.duty_class = s.duty_class
        WHERE s.id=?
        LIMIT 1
      `,
      [redClass, sessionId],
      (err, session) => {
        if (err) return res.status(500).json({ error: err.message })
        if (!session) return res.status(404).json({ error: "Session not found" })

        if (session.date !== date) {
          return res.status(400).json({ error: "Date must match session date" })
        }

        if (claimedClass && claimedClass !== session.duty_class) {
          return res.status(403).json({ error: "Wrong class" })
        }

        isWeekClosed(session.week_id, (err, closed) => {
          if (err) return res.status(500).json({ error: err.message })
          if (closed) return res.status(403).json({ error: "Week closed" })

        db.get(
          `SELECT start_date,end_date FROM schedule_weeks WHERE id=? LIMIT 1`,
          [session.week_id],
          (err, week) => {
            if (err) return res.status(500).json({ error: err.message })
            if (!week) return res.status(404).json({ error: "Week not found" })

            if (!(week.start_date <= date && date <= week.end_date)) {
              return res.status(400).json({ error: "Date out of week" })
            }

            const now = time.now()
            db.run(
              `
                INSERT INTO daily_bonus
                (session_id,week_id,date,class_name,points,min_score,all_above_9,source,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(week_id,date,class_name)
                DO UPDATE SET
                  session_id=excluded.session_id,
                  points=excluded.points,
                  min_score=excluded.min_score,
                  all_above_9=excluded.all_above_9,
                  source=excluded.source,
                  updated_at=excluded.updated_at
              `,
              [
                sessionId,
                session.week_id,
                date,
                session.duty_class,
                points,
                minScore,
                allAbove9,
                source,
                now,
                now,
              ],
              (err) => {
                if (err) return res.status(500).json({ error: err.message })

                // After updating daily_bonus, recheck weekly_bonus eligibility
                db.get(
                  `
                    SELECT
                      COUNT(*) as session_count,
                      SUM(CASE WHEN b.min_score IS NOT NULL THEN 1 ELSE 0 END) as bonus_count,
                      SUM(CASE WHEN b.min_score >= 9 THEN 1 ELSE 0 END) as ok_count
                    FROM duty_sessions s
                    LEFT JOIN daily_bonus b
                      ON b.week_id = s.week_id
                     AND b.date = s.date
                     AND b.class_name = s.duty_class
                  WHERE s.week_id=?
                    AND s.duty_class=?
                  `,
                  [session.week_id, session.duty_class],
                  (err, checkRow) => {
                    if (err) return res.status(500).json({ error: err.message })

                    const sessionCount = Number(checkRow?.session_count || 0)
                    const bonusCount = Number(checkRow?.bonus_count || 0)
                    const okCount = Number(checkRow?.ok_count || 0)
                    const eligible = bonusCount > 0 && okCount === bonusCount

                    // Check if weekly_bonus already exists
                    db.get(
                      `SELECT points FROM weekly_bonus WHERE week_id=? AND class_name=?`,
                      [session.week_id, session.duty_class],
                      (err, existingBonus) => {
                        if (err) return res.status(500).json({ error: err.message })

                        if (eligible && !existingBonus) {
                          // Eligible but no weekly bonus yet -> add it
                          db.run(
                            `INSERT INTO weekly_bonus (week_id,class_name,points,reason,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
                            [session.week_id, session.duty_class, 30, "Thurong tu so dau bai: tat ca tiet >= 9", now, now],
                            (err) => {
                              if (err) return res.status(500).json({ error: err.message })
                              recordLog()
                            }
                          )
                        } else if (!eligible && existingBonus && existingBonus.points === 30) {
                          // Not eligible but has weekly bonus -> remove it
                          db.run(
                            `DELETE FROM weekly_bonus WHERE week_id=? AND class_name=? AND points=30`,
                            [session.week_id, session.duty_class],
                            (err) => {
                              if (err) return res.status(500).json({ error: err.message })
                              recordLog()
                            }
                          )
                        } else {
                          // No change needed
                          recordLog()
                        }

                        function recordLog() {
                          db.run(
                            `INSERT INTO duty_revision_logs (session_id,action,created_at) VALUES(?,?,?)`,
                            [sessionId, "bonus:apply_daily_bonus", time.now()],
                            (err) => {
                              if (err) return res.status(500).json({ error: err.message })
                              res.json({ success: true, eligible, bonus_adjusted: eligible !== !existingBonus })
                            }
                          )
                        }
                      }
                    )
                  }
                )
              },
            )
          },
        )
      },
    )
        })
  },
)

module.exports = router
