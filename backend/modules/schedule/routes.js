const express = require("express")
const db = require("../../db")
const { all, get, run, withTransaction, mapSqliteError } = require("../../utils/dbp")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

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

/*
PUBLIC CURRENT WEEK
*/
router.get("/",(req,res)=>{

  const today = time.today()

  db.get(`
    SELECT *
    FROM schedule_weeks
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
      FROM schedule_weeks
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
    SELECT *
    FROM schedule_weeks
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
    SELECT *
    FROM schedule_weeks
    WHERE id=?
  `,[id],(err,week)=>{

    if(!week){
      return res.status(404).json({error:"Week not found"})
    }

    db.all(`
      SELECT red_class,duty_class
      FROM schedule_assignments
      WHERE week_id=?
    `,[id],(err,rows)=>{

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

  const {week_number,start_date,end_date} = req.body

  const start = convertDate(start_date)
  const end = convertDate(end_date)

  if(!week_number || !start || !end){
    return res.status(400).json({error:"Invalid date"})
  }

  ;(async () => {
    try {
      const { week_id: newWeekId } = await withTransaction(async () => {
        const ins = await run(
          `
          INSERT INTO schedule_weeks
          (week_number,start_date,end_date,created_at)
          VALUES(?,?,?,?)
        `,
          [week_number, start, end, time.now()],
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
      const out = mapSqliteError(err, err.message)
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

    const { week_id, start_date, end_date } = req.body
    const start = normalizeDate(start_date)
    const end = normalizeDate(end_date)

    if(!week_id || !start || !end){
      return res.status(400).json({error:"Invalid date"})
    }
    if(start > end){
      return res.status(400).json({error:"Start date must be before end date"})
    }

    ;(async () => {
      try {
        await run(
          `
            UPDATE schedule_weeks
            SET start_date=?, end_date=?
            WHERE id=?
          `,
          [start, end, week_id],
        )
        res.json({ success: true })
      } catch (err) {
        const out = mapSqliteError(err, err.message)
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
      const out = await run("DELETE FROM schedule_weeks WHERE id=?", [id])
      res.json({ success: true, deleted: out.changes })
    } catch (err) {
      const out = mapSqliteError(err, err.message)
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
      const out = mapSqliteError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  })()

})



module.exports = router
