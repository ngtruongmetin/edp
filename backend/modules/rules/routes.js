const express = require("express")
const db = require("../../db")
const { isForeignKeyError, mapSqliteError } = require("../../utils/dbp")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

const router = express.Router()


/*
GET RULES (PUBLIC)
*/
router.get(
"/",
requireLogin,
(req,res)=>{

  db.all(`
    SELECT id, category, name, score_delta
    FROM rules
    ORDER BY category, id
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
GET RULES (ADMIN)
*/
router.get(
"/admin",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  db.all(`
    SELECT id, category, name, score_delta
    FROM rules
    ORDER BY category, id
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
CREATE RULE
*/
router.post(
"/create",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const {category,name,score_delta} = req.body

  if(!category || !name){
    return res.status(400).json({error:"Missing data"})
  }

  db.run(`
    INSERT INTO rules(category,name,score_delta)
    VALUES(?,?,?)
  `,
  [category,name,score_delta || 0],
  function(err){

    if(err){
      return res.status(500).json({error:err.message})
    }

    res.json({success:true})

  })

})



/*
UPDATE RULE
*/
router.patch(
"/:id",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  const {category,name,score_delta} = req.body

  db.run(`
    UPDATE rules
    SET category=?, name=?, score_delta=?
    WHERE id=?
  `,
  [category,name,score_delta,req.params.id],
  function(err){

    if(err){
      return res.status(500).json({error:err.message})
    }

    res.json({success:true})

  })

})



/*
DELETE RULE
*/
router.delete(
"/:id",
requireLogin,
requireRole(["admin"]),
(req,res)=>{

  db.run(
    "DELETE FROM rules WHERE id=?",
    [req.params.id],
    function(err){

      if(err){
        if (isForeignKeyError(err)) {
          return res.status(409).json({
            error:
              "Không thể xóa lỗi vi phạm vì đã được dùng trong phiếu trực (cần xóa/sửa phiếu trước)",
          })
        }
        const out = mapSqliteError(err, err.message)
        return res.status(out.status).json({ error: out.error })
      }

      res.json({success:true})

    }
  )

})

module.exports = router
