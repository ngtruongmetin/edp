const express = require("express")
const db = require("../../db")
const { all, get, run, withTransaction, mapDatabaseError } = require("../../utils/dbp")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const SystemSettingService = require("../system-settings/service")

const time = require("../../utils/time")

const router = express.Router()
function convertDate(input){

  if(!input) return null

  const parts = input.split("/")

  if(parts.length !== 3) return null

  const day = parts[0].padStart(2,"0")
  const month = parts[1].padStart(2,"0")
  const year = parts[2]

  return `${year}-${month}-${day}`

}

function normalizeDate(input){
  if(!input) return null
  if(/^\d{4}-\d{2}-\d{2}$/.test(input)) return input
  if(String(input).includes("/")) return convertDate(String(input))
  return null
}

function isPositiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0
}

function weekSelectSql() {
  return `
    SELECT
      w.*,
      m.id as month_id,
      m.month_number,
      m.month_key,
      m.name as month_name,
      s.id as semester_id,
      s.semester_number,
      s.name as semester_name,
      y.id as school_year_id,
      y.name as school_year_name
    FROM schedule_weeks w
    JOIN months m
      ON m.id = w.month_id
    JOIN semesters s
      ON s.id = m.semester_id
    JOIN school_years y
      ON y.id = s.school_year_id
  `
}

function parseSchoolYearName(input) {
  const name = String(input || "").trim().replace("–", "-")
  const match = name.match(/^(\d{4})-(\d{4})$/)
  if (!match) return null

  const startYear = Number(match[1])
  const endYear = Number(match[2])
  if (endYear !== startYear + 1) return null

  return { name, startYear, endYear }
}

async function getActiveSchoolYear() {
  const configuredName = await SystemSettingService.get("school_year", "2026-2027")
  const parsed = parseSchoolYearName(configuredName) || parseSchoolYearName("2026-2027")

  const out = await run(
    `
      INSERT INTO school_years (name, start_year, end_year, created_at)
      VALUES(?,?,?,?)
      ON CONFLICT (name) DO UPDATE
      SET start_year = EXCLUDED.start_year,
          end_year = EXCLUDED.end_year
    `,
    [parsed.name, parsed.startYear, parsed.endYear, time.now()],
  )

  const id = out.lastID
  if (id) return { id, name: parsed.name, start_year: parsed.startYear, end_year: parsed.endYear }

  return get(
    `
      SELECT id, name, start_year, end_year
      FROM school_years
      WHERE name=?
      LIMIT 1
    `,
    [parsed.name],
  )
}

function getSchoolYearById(schoolYearId) {
  return get(
    `
      SELECT id, name, start_year, end_year
      FROM school_years
      WHERE id=?
      LIMIT 1
    `,
    [schoolYearId],
  )
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
  return romanByNumber[Number(number)] || null
}

function semesterName(number) {
  const roman = romanNumeral(number)
  return roman ? `Học kỳ ${roman}` : null
}

function normalizeMonthKey(input) {
  const monthKey = String(input || "").trim()
  const match = monthKey.match(/^(\d{2})\/(\d{4})$/)
  if (!match) return null

  const monthNumber = Number(match[1])
  if (monthNumber < 1 || monthNumber > 12) return null

  return {
    monthKey,
    monthNumber,
  }
}

function hasRow(row) {
  return row && Number(row.count || row.cnt || 0) > 0
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

function createLockError(message) {
  const error = new Error(message)
  error.status = 403
  return error
}

async function assertSemesterUnlocked(semesterId) {
  const row = await get(
    `
      SELECT
        s.id,
        ss.closed_at as semester_closed_at,
        ys.closed_at as year_closed_at
      FROM semesters s
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      LEFT JOIN year_summaries ys
        ON ys.year_key = y.name
      WHERE s.id=?
      LIMIT 1
    `,
    [semesterId],
  )
  if (!row) throw createLockError("Semester not found")
  if (row.year_closed_at) throw createLockError("Year closed")
  if (row.semester_closed_at) throw createLockError("Semester closed")
}

async function assertMonthUnlocked(monthId) {
  const row = await get(
    `
      SELECT
        m.id,
        ms.closed_at as month_closed_at,
        ss.closed_at as semester_closed_at,
        ys.closed_at as year_closed_at
      FROM months m
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN month_summaries ms
        ON ms.month_key = m.month_key
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      LEFT JOIN year_summaries ys
        ON ys.year_key = y.name
      WHERE m.id=?
      LIMIT 1
    `,
    [monthId],
  )
  if (!row) throw createLockError("Month not found")
  if (row.year_closed_at) throw createLockError("Year closed")
  if (row.semester_closed_at) throw createLockError("Semester closed")
  if (row.month_closed_at) throw createLockError("Month closed")
}

async function assertWeekUnlocked(weekId) {
  const row = await get(
    `
      SELECT
        w.id,
        wc.closed_at as week_closed_at,
        ms.closed_at as month_closed_at,
        ss.closed_at as semester_closed_at,
        ys.closed_at as year_closed_at
      FROM schedule_weeks w
      JOIN months m
        ON m.id = w.month_id
      JOIN semesters s
        ON s.id = m.semester_id
      JOIN school_years y
        ON y.id = s.school_year_id
      LEFT JOIN week_closings wc
        ON wc.week_id = w.id
      LEFT JOIN month_summaries ms
        ON ms.month_key = m.month_key
      LEFT JOIN semester_summaries ss
        ON ss.semester_key = (y.name || '-HK' || s.semester_number)
      LEFT JOIN year_summaries ys
        ON ys.year_key = y.name
      WHERE w.id=?
      LIMIT 1
    `,
    [weekId],
  )
  if (!row) throw createLockError("Week not found")
  if (row.year_closed_at) throw createLockError("Year closed")
  if (row.semester_closed_at) throw createLockError("Semester closed")
  if (row.month_closed_at) throw createLockError("Month closed")
  if (row.week_closed_at) throw createLockError("Week closed")
}

/*
PUBLIC CURRENT WEEK
*/
router.get("/",(req,res)=>{

  const today = time.today()

  db.get(`
    ${weekSelectSql()}
    WHERE start_date <= ?
      AND end_date >= ?
    ORDER BY week_number DESC
    LIMIT 1
  `,[today, today],(err,week)=>{

    if(err) return res.status(500).json({error:err.message})
    if(!week) return res.json({})

    db.all(`
      SELECT red_class,duty_class
      FROM schedule_assignments
      WHERE week_id=?
    `,[week.id],(err,rows)=>{

      res.json({
        week,
        assignments:rows
      })

    })

  })

})

/*
PUBLIC: ALL WEEKS WITH ASSIGNMENTS
*/
router.get("/all", (req, res) => {
  db.all(
    `
      SELECT *
      FROM (${weekSelectSql()}) weeks
      ORDER BY week_number DESC
    `,
    [],
    (err, weeks) => {
      if (err) return res.status(500).json({ error: err.message })

      if (!weeks || weeks.length === 0) {
        return res.json({ weeks: [] })
      }

      const ids = weeks.map((w) => w.id)
      const placeholders = ids.map(() => "?").join(",")

      db.all(
        `
          SELECT week_id, red_class, duty_class
          FROM schedule_assignments
          WHERE week_id IN (${placeholders})
        `,
        ids,
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message })

          const byWeek = new Map()
          rows.forEach((r) => {
            if (!byWeek.has(r.week_id)) byWeek.set(r.week_id, [])
            byWeek.get(r.week_id).push({
              red_class: r.red_class,
              duty_class: r.duty_class,
            })
          })

          const out = weeks.map((w) => ({
            ...w,
            assignments: byWeek.get(w.id) || [],
          }))

          res.json({ weeks: out })
        },
      )
    },
  )
})



/*
GET ALL WEEKS
*/
router.get("/admin",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  db.all(`
    ${weekSelectSql()}
    ORDER BY week_number DESC
  `,[],(err,rows)=>{

    if(err) return res.status(500).json({error:err.message})

    res.json(rows)

  })

})



/*
GET WEEK DETAIL
*/
router.get("/week/:id",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const id = req.params.id

  db.get(`
    ${weekSelectSql()}
    WHERE w.id=?
  `,[id],(err,week)=>{

    if(err) return res.status(500).json({error:err.message})
    if(!week){
      return res.status(404).json({error:"Week not found"})
    }

    db.all(`
      SELECT red_class,duty_class
      FROM schedule_assignments
      WHERE week_id=?
    `,[id],(err,rows)=>{

      if(err) return res.status(500).json({error:err.message})
      res.json({
        week,
        assignments:rows
      })

    })

  })

})



/*
CREATE WEEK
*/
router.post("/create-week",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const {week_number,start_date,end_date,month_id} = req.body

  const start = convertDate(start_date)
  const end = convertDate(end_date)
  const monthId = Number(month_id)
  const weekNumber = Number(week_number)

  if(!Number.isInteger(weekNumber) || weekNumber <= 0 || !start || !end || !monthId){
    return res.status(400).json({error:"Invalid date"})
  }
  if(start > end){
    return res.status(400).json({error:"Start date must be before end date"})
  }

  ;(async () => {
    try {
      await assertMonthUnlocked(monthId)
      const { week_id: newWeekId } = await withTransaction(async () => {
        const ins = await run(
          `
          INSERT INTO schedule_weeks
          (month_id,week_number,start_date,end_date,created_at)
          VALUES(?,?,?,?,?)
        `,
          [monthId, weekNumber, start, end, time.now()],
        )

        const newWeekId = ins.lastID

        // Copy assignments from last week, but only keep rows referencing existing classes
        // (fresh FK enforcement would otherwise reject old/orphan assignments).
        const lastWeek = await get(
          `
          SELECT id
          FROM schedule_weeks
          WHERE id < ?
          ORDER BY id DESC
          LIMIT 1
        `,
          [newWeekId],
        )

        if (lastWeek?.id) {
          const rows = await all(
            `
            SELECT sa.red_class, sa.duty_class
            FROM schedule_assignments sa
            JOIN classes cr ON cr.name = sa.red_class
            JOIN classes cd ON cd.name = sa.duty_class
            WHERE sa.week_id=?
          `,
            [lastWeek.id],
          )

          for (const r of rows) {
            await run(
              `
              INSERT INTO schedule_assignments
              (week_id,red_class,duty_class)
              VALUES(?,?,?)
            `,
              [newWeekId, r.red_class, r.duty_class],
            )
          }
        }

        return { week_id: newWeekId }
      })

      res.json({ week_id: newWeekId })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  })()

})

/*
UPDATE WEEK (dates)
*/
router.post(
  "/update-week",
  requireLogin,
  requireRole(["admin"]),
  (req,res)=>{

    const { week_id, start_date, end_date, month_id, week_number } = req.body
    const start = normalizeDate(start_date)
    const end = normalizeDate(end_date)
    const monthId = month_id ? Number(month_id) : null
    const weekNumber =
      week_number === undefined || week_number === null || week_number === ""
        ? null
        : Number(week_number)

    if(!week_id || !start || !end){
      return res.status(400).json({error:"Invalid date"})
    }
    if(start > end){
      return res.status(400).json({error:"Start date must be before end date"})
    }
    if(weekNumber !== null && (!Number.isInteger(weekNumber) || weekNumber <= 0)){
      return res.status(400).json({error:"Invalid week_number"})
    }

    ;(async () => {
      try {
        await assertWeekUnlocked(week_id)
        if (monthId) await assertMonthUnlocked(monthId)
        if (monthId) {
          await run(
            `
              UPDATE schedule_weeks
              SET month_id=?,
                  week_number=COALESCE(?, week_number),
                  start_date=?,
                  end_date=?
              WHERE id=?
            `,
            [monthId, weekNumber, start, end, week_id],
          )
        } else {
          await run(
            `
              UPDATE schedule_weeks
              SET week_number=COALESCE(?, week_number),
                  start_date=?,
                  end_date=?
              WHERE id=?
            `,
            [weekNumber, start, end, week_id],
          )
        }
        res.json({ success: true })
      } catch (err) {
        const out = mapDatabaseError(err, err.message)
        res.status(out.status).json({ error: out.error })
      }
    })()

  }
)



/*
DELETE WEEK
*/
router.delete("/week/:id",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const id = req.params.id

  ;(async () => {
    try {
      await assertWeekUnlocked(id)
      const out = await run("DELETE FROM schedule_weeks WHERE id=?", [id])
      res.json({ success: true, deleted: out.changes })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  })()

})



/*
SAVE SCHEDULE
*/
router.post("/save",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const {week_id,assignments} = req.body

  if(!week_id || !Array.isArray(assignments)){
    return res.status(400).json({error:"Invalid request"})
  }

  ;(async () => {
    try {
      await assertWeekUnlocked(week_id)
      await withTransaction(async () => {
        await run(
          `
          DELETE FROM schedule_assignments
          WHERE week_id=?
        `,
          [week_id],
        )

        for (const a of assignments) {
          await run(
            `
            INSERT INTO schedule_assignments
            (week_id,red_class,duty_class)
            VALUES(?,?,?)
          `,
            [week_id, a.red_class, a.duty_class],
          )
        }
      })

      res.json({ success: true })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  })()

})

router.get(
  "/admin/time",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const activeSchoolYear = await getActiveSchoolYear()
      const schoolYears = await all(
        `
          SELECT id, name, start_year, end_year, created_at
          FROM school_years
          WHERE id=?
          ORDER BY start_year DESC
        `,
        [activeSchoolYear.id],
      )
      const semesters = await all(
        `
          SELECT s.id, s.school_year_id, s.semester_number, s.name, s.created_at, y.name as school_year_name
          FROM semesters s
          JOIN school_years y
            ON y.id = s.school_year_id
          WHERE s.school_year_id=?
          ORDER BY y.start_year DESC, s.semester_number ASC
        `,
        [activeSchoolYear.id],
      )
      const months = await all(
        `
          SELECT
            m.id,
            m.semester_id,
            m.month_number,
            m.month_key,
            m.name,
            m.created_at,
            s.semester_number,
            s.name as semester_name,
            y.id as school_year_id,
            y.name as school_year_name
          FROM months m
          JOIN semesters s
            ON s.id = m.semester_id
          JOIN school_years y
            ON y.id = s.school_year_id
          WHERE s.school_year_id=?
          ORDER BY y.start_year DESC, s.semester_number ASC, ${monthOrderSql("m")} ASC, m.id ASC
        `,
        [activeSchoolYear.id],
      )

      res.json({ school_years: schoolYears || [], semesters: semesters || [], months: months || [] })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  },
)

router.post(
  "/admin/school-years",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const parsed = parseSchoolYearName(req.body.name)
    if (!parsed) return res.status(400).json({ error: "Năm học phải có dạng yyyy-yyyy" })

    try {
      const out = await run(
        `
          INSERT INTO school_years (name, start_year, end_year, created_at)
          VALUES(?,?,?,?)
        `,
        [parsed.name, parsed.startYear, parsed.endYear, time.now()],
      )
      res.json({ id: out.lastID, name: parsed.name })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.post(
  "/admin/semesters",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const semesterNumber = Number(req.body.semester_number)
    if (!Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 9) {
      return res.status(400).json({ error: "Dữ liệu học kỳ không hợp lệ" })
    }

    try {
      const schoolYear = req.body.school_year_id
        ? await getSchoolYearById(Number(req.body.school_year_id))
        : await getActiveSchoolYear()
      if (!schoolYear) return res.status(404).json({ error: "Năm học không tồn tại" })

      const out = await run(
        `
          INSERT INTO semesters (school_year_id, semester_number, name, created_at)
          VALUES(?,?,?,?)
        `,
        [schoolYear.id, semesterNumber, semesterName(semesterNumber), time.now()],
      )
      res.json({ id: out.lastID })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.put(
  "/admin/semesters/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const semesterId = Number(req.params.id)
    const semesterNumber = Number(req.body.semester_number)

    if (!isPositiveInteger(semesterId) || !Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 9) {
      return res.status(400).json({ error: "Dữ liệu học kỳ không hợp lệ" })
    }

    try {
      await assertSemesterUnlocked(semesterId)
      const out = await run(
        `
          UPDATE semesters
          SET semester_number=?, name=?
          WHERE id=?
        `,
        [semesterNumber, semesterName(semesterNumber), semesterId],
      )

      if (!out.changes) return res.status(404).json({ error: "Học kỳ không tồn tại" })
      res.json({ success: true, id: semesterId, semester_number: semesterNumber, name: semesterName(semesterNumber) })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.delete(
  "/admin/semesters/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const semesterId = Number(req.params.id)
    if (!isPositiveInteger(semesterId)) return res.status(400).json({ error: "Học kỳ không hợp lệ" })

    try {
      await assertSemesterUnlocked(semesterId)
      const monthCount = await get(
        `
          SELECT COUNT(*)::int as count
          FROM months
          WHERE semester_id=?
        `,
        [semesterId],
      )

      if (hasRow(monthCount)) {
        return res.status(409).json({ error: "Không thể xóa học kỳ vì vẫn còn tháng đang sử dụng" })
      }

      const weekCount = await get(
        `
          SELECT COUNT(*)::int as count
          FROM schedule_weeks w
          JOIN months m
            ON m.id = w.month_id
          WHERE m.semester_id=?
        `,
        [semesterId],
      )

      if (hasRow(weekCount)) {
        return res.status(409).json({ error: "Không thể xóa học kỳ vì vẫn còn tuần đang sử dụng" })
      }

      const out = await run("DELETE FROM semesters WHERE id=?", [semesterId])
      if (!out.changes) return res.status(404).json({ error: "Học kỳ không tồn tại" })
      res.json({ success: true, deleted: out.changes })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.post(
  "/admin/months",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const semesterId = Number(req.body.semester_id)
    const parsedMonth = normalizeMonthKey(req.body.month_key)
    if (!semesterId || !parsedMonth) {
      return res.status(400).json({ error: "Tháng phải đúng định dạng MM/YYYY" })
    }

    try {
      await assertSemesterUnlocked(semesterId)
      const out = await run(
        `
          INSERT INTO months (semester_id, month_number, month_key, name, created_at)
          VALUES(?,?,?,?,?)
        `,
        [
          semesterId,
          parsedMonth.monthNumber,
          parsedMonth.monthKey,
          `Tháng ${parsedMonth.monthNumber}`,
          time.now(),
        ],
      )
      res.json({ id: out.lastID, month_key: parsedMonth.monthKey })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.put(
  "/admin/months/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const monthId = Number(req.params.id)
    const semesterId = req.body.semester_id ? Number(req.body.semester_id) : null
    const parsedMonth = normalizeMonthKey(req.body.month_key)

    if (!isPositiveInteger(monthId) || !parsedMonth) {
      return res.status(400).json({ error: "Dữ liệu tháng không hợp lệ" })
    }

    if (semesterId !== null && !isPositiveInteger(semesterId)) {
      return res.status(400).json({ error: "Học kỳ không hợp lệ" })
    }

    try {
      const current = await get(
        `
          SELECT id, semester_id, month_key
          FROM months
          WHERE id=?
          LIMIT 1
        `,
        [monthId],
      )

      if (!current) return res.status(404).json({ error: "Tháng không tồn tại" })

      await assertMonthUnlocked(monthId)
      if (semesterId !== null) await assertSemesterUnlocked(semesterId)

      await withTransaction(async () => {
        await run(
          `
            UPDATE months
            SET semester_id=COALESCE(?, semester_id),
                month_number=?,
                month_key=?,
                name=?
            WHERE id=?
          `,
          [
            semesterId,
            parsedMonth.monthNumber,
            parsedMonth.monthKey,
            `Tháng ${parsedMonth.monthNumber}`,
            monthId,
          ],
        )

        if (String(current.month_key) !== parsedMonth.monthKey) {
          await run(
            `
              UPDATE month_summaries
              SET month_key=?
              WHERE month_key=?
            `,
            [parsedMonth.monthKey, current.month_key],
          )
          await run(
            `
              UPDATE month_adjustments
              SET month_key=?
              WHERE month_key=?
            `,
            [parsedMonth.monthKey, current.month_key],
          )
          await run(
            `
              UPDATE month_scores
              SET month_key=?
              WHERE month_key=?
            `,
            [parsedMonth.monthKey, current.month_key],
          )
          await run(
            `
              UPDATE semester_summaries
              SET month_keys = REPLACE(month_keys, ?, ?)
              WHERE month_keys LIKE ?
            `,
            [
              `"${current.month_key}"`,
              `"${parsedMonth.monthKey}"`,
              `%"${current.month_key}"%`,
            ],
          )
        }
      })

      res.json({ success: true, id: monthId, month_key: parsedMonth.monthKey })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)

router.delete(
  "/admin/months/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const monthId = Number(req.params.id)
    if (!isPositiveInteger(monthId)) return res.status(400).json({ error: "Tháng không hợp lệ" })

    try {
      const current = await get(
        `
          SELECT id, month_key
          FROM months
          WHERE id=?
          LIMIT 1
        `,
        [monthId],
      )
      if (!current) return res.status(404).json({ error: "Tháng không tồn tại" })

      await assertMonthUnlocked(monthId)

      const weekCount = await get(
        `
          SELECT COUNT(*)::int as count
          FROM schedule_weeks
          WHERE month_id=?
        `,
        [monthId],
      )

      if (hasRow(weekCount)) {
        return res.status(409).json({ error: "Không thể xóa tháng vì vẫn còn tuần đang sử dụng" })
      }

      const out = await withTransaction(async () => {
        await run("DELETE FROM month_scores WHERE month_key=?", [current.month_key])
        await run("DELETE FROM month_adjustments WHERE month_key=?", [current.month_key])
        await run("DELETE FROM month_summaries WHERE month_key=?", [current.month_key])
        return run("DELETE FROM months WHERE id=?", [monthId])
      })
      res.json({ success: true, deleted: out.changes })
    } catch (err) {
      const out = mapDatabaseError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  },
)



module.exports = router
