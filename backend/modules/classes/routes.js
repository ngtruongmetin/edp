const express = require("express")
const bcrypt = require("bcrypt")
const db = require("../../db")
const updateExcel = require("../../utils/updateExcel")
const { get, run, withTransaction, mapSqliteError, isUniqueError } = require("../../utils/dbp")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

const router = express.Router()



/*
GET classes for admin
*/
router.get(
"/admin",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  db.all(`
    SELECT
      c.id,
      c.name,
      c.grade,
      c.is_active,
      a.pin_bcs
    FROM classes c
    LEFT JOIN accounts a
    ON a.class_id = c.id
    ORDER BY
      c.grade ASC,
      CAST(SUBSTR(c.name, INSTR(c.name,'A')+1) AS INTEGER)
  `,
  [],
  (err,rows)=>{

    if(err) return res.status(500).json({error:err.message})

    res.json(rows)

  })

})

/*
PUBLIC CLASSES (for login page)
*/
router.get("/", (req,res)=>{

  db.all(`
    SELECT
      id,
      name
    FROM classes
    WHERE is_active = 1
    ORDER BY
      grade ASC,
      CAST(SUBSTR(name, INSTR(name,'A')+1) AS INTEGER)
  `,
  [],
  (err,rows)=>{

    if(err){
      return res.status(500).json({error:err.message})
    }

    res.json(rows)

  })

})

/*
create class
*/
router.post(
"/create",
requireLogin,
requireRole(["admin"]),
async (req,res)=>{

  const {name} = req.body

  if(!name){
    return res.status(400).json({error:"Missing class name"})
  }

  const grade = parseInt(name.substring(0,2))

  const gvcnPass = Math.random().toString(36).slice(-6)
  const bcsPass = Math.random().toString(36).slice(-6)
  const codoPass = Math.random().toString(36).slice(-6)

  const pin = Math.floor(100000 + Math.random()*900000)

  const hash_gvcn = await bcrypt.hash(gvcnPass,10)
  const hash_bcs = await bcrypt.hash(bcsPass,10)
  const hash_codo = await bcrypt.hash(codoPass,10)

  try {
    const classId = await withTransaction(async () => {
      const out = await run(
        `
        INSERT INTO classes(name,grade,is_active)
        VALUES(?,?,1)
      `,
        [name, grade],
      )

      const classId = out.lastID

      await run(
        `
        INSERT INTO accounts
        (class_id,password_gvcn,password_bcs,password_codo,pin_bcs)
        VALUES(?,?,?,?,?)
      `,
        [classId, hash_gvcn, hash_bcs, hash_codo, pin],
      )

      return classId
    })

    // Side effect after DB commit
    updateExcel(name, {
      gvcn_password: gvcnPass,
      bcs_password: bcsPass,
      codo_password: codoPass,
      pin_bcs: pin,
    })

    res.json({
      success: true,
      passwords: {
        gvcn: gvcnPass,
        bcs: bcsPass,
        codo: codoPass,
        pin,
      },
      class_id: classId,
    })
  } catch (err) {
    if (isUniqueError(err)) {
      return res.status(409).json({ error: "Lớp đã tồn tại" })
    }
    const out = mapSqliteError(err, err.message)
    return res.status(out.status).json({ error: out.error })
  }

})



/*
delete class
*/
router.delete(
"/:id",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const id = req.params.id

  ;(async () => {
    try {
      const row = await get("SELECT name FROM classes WHERE id=?", [id])
      const out = await run("DELETE FROM classes WHERE id=?", [id])

      if (row?.name && out.changes) {
        updateExcel(row.name, { deleted: true })
      }

      res.json({ success: true, deleted: out.changes })
    } catch (err) {
      const out = mapSqliteError(err, err.message)
      res.status(out.status).json({ error: out.error })
    }
  })()

})



/*
toggle active
*/
router.patch(
"/:id/toggle",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  db.run(`
    UPDATE classes
    SET is_active = NOT is_active
    WHERE id = ?
  `,
  [req.params.id],
  function(err){

    if(err){
      return res.status(500).json({error:err.message})
    }

    res.json({success:true})

  })

})



/*
reset password
*/
router.post(
"/:id/reset-password/:role",
requireLogin,
requireRole(["admin"]),
async (req,res)=>{

  const classId = req.params.id
  const role = req.params.role

  let column

  if(role==="gvcn") column="password_gvcn"
  if(role==="bcs") column="password_bcs"
  if(role==="codo") column="password_codo"

  if(!column){
    return res.status(400).json({error:"Invalid role"})
  }

  const newPassword = Math.random().toString(36).slice(-6)

  const hash = await bcrypt.hash(newPassword,10)

  db.run(`
    UPDATE accounts
    SET ${column} = ?
    WHERE class_id = ?
  `,
  [hash,classId],
  function(err){

    if(err){
      return res.status(500).json({error:err.message})
    }

    /* get class name to update excel */
    db.get(
      "SELECT name FROM classes WHERE id=?",
      [classId],
      (err,row)=>{

        if(row){

          const data = {}

          if(role==="gvcn") data.gvcn_password = newPassword
          if(role==="bcs") data.bcs_password = newPassword
          if(role==="codo") data.codo_password = newPassword

          updateExcel(row.name,data)

        }

      }
    )

    res.json({
      success:true,
      password:newPassword
    })

  })

})



/*
reset pin
*/
router.post(
"/:id/reset-pin",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const classId = req.params.id

  const newPin = Math.floor(100000 + Math.random()*900000)

  db.run(`
    UPDATE accounts
    SET pin_bcs = ?
    WHERE class_id = ?
  `,
  [newPin,classId],
  function(err){

    if(err){
      return res.status(500).json({error:err.message})
    }

    db.get(
      "SELECT name FROM classes WHERE id=?",
      [classId],
      (err,row)=>{

        if(row){

          updateExcel(row.name,{
            pin_bcs:newPin
          })

        }

      }
    )

    res.json({
      success:true,
      pin:newPin
    })

  })

})



module.exports = router
