const express = require("express")
const bcrypt = require("bcrypt")
const db = require("../../db")

const requireLogin = require("../../middleware/requireLogin")
const time = require("../../utils/time")

const router = express.Router()

/*
POST /api/account/change-password
Change password for any role (bancansu, co_do, admin, gvcn)
body: { old_password, new_password, confirm_password }
*/
router.post("/change-password", requireLogin, (req, res) => {
  const { old_password, new_password, confirm_password } = req.body

  if (!old_password || !new_password || !confirm_password) {
    return res.status(400).json({ error: "Missing fields" })
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({ error: "Mật khẩu không khớp" })
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: "Mật khẩu phải dài ít nhất 6 ký tự" })
  }

  const role = req.session.user?.role // "bancansu", "co_do", "admin", "gvcn"
  const classId = req.session.user?.class_id

  if (!role || !classId) {
    return res.status(401).json({ error: "Không có thông tin role" })
  }

  // Role names are not the same as password column names:
  // - bancansu -> password_bcs
  // - co_do    -> password_codo
  // - gvcn     -> password_gvcn
  let passwordColumn = ""
  let flagColumn = ""
  if (role === "bancansu") {
    passwordColumn = "password_bcs"
    flagColumn = "password_changed_bcs"
  } else if (role === "co_do") {
    passwordColumn = "password_codo"
    flagColumn = "password_changed_codo"
  } else if (role === "gvcn") {
    passwordColumn = "password_gvcn"
    flagColumn = "password_changed_gvcn"
  } else {
    return res.status(400).json({ error: "Role không hợp lệ" })
  }

  // Get current password hash
  db.get(
    `SELECT ${passwordColumn} FROM accounts WHERE class_id=?`,
    [classId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Account not found" })

      const hashedPassword = row[passwordColumn]

      // Verify old password
      bcrypt.compare(old_password, hashedPassword, (err, isMatch) => {
        if (err) return res.status(500).json({ error: err.message })

        if (!isMatch) {
          return res.status(401).json({ error: "Mật khẩu cũ không đúng" })
        }

        // Hash new password
        bcrypt.hash(new_password, 10, (err, hash) => {
          if (err) return res.status(500).json({ error: err.message })

          const now = time.now()
          db.run(
            `UPDATE accounts SET ${passwordColumn}=?, ${flagColumn}=1, password_changed=1, created_at=? WHERE class_id=?`,
            [hash, now, classId],
            (err) => {
              if (err) return res.status(500).json({ error: err.message })
              res.json({ success: true, message: "Đã cập nhật mật khẩu" })
            }
          )
        })
      })
    }
  )
})

/*
POST /api/account/change-pin
Change PIN for BCS only
body: { old_pin, new_pin, confirm_pin }
*/
router.post("/change-pin", requireLogin, (req, res) => {
  const { old_pin, new_pin, confirm_pin } = req.body
  const role = req.session.user?.role
  const classId = req.session.user?.class_id

  // Only BCS can change PIN
  if (role !== "bancansu") {
    return res.status(403).json({ error: "Chỉ lớp trưởng mới có PIN" })
  }

  if (!old_pin || !new_pin || !confirm_pin) {
    return res.status(400).json({ error: "Missing fields" })
  }

  if (new_pin !== confirm_pin) {
    return res.status(400).json({ error: "Mã PIN không khớp" })
  }

  if (String(new_pin).length < 4 || String(new_pin).length > 8) {
    return res.status(400).json({ error: "Mã PIN phải từ 4-8 ký tự" })
  }

  if (!classId) {
    return res.status(401).json({ error: "Không có thông tin lớp" })
  }

  // Get current PIN
  db.get(
    `SELECT pin_bcs FROM accounts WHERE class_id=?`,
    [classId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Account not found" })

      // Verify old PIN (simple string comparison since it's not hashed)
      if (String(row.pin_bcs) !== String(old_pin)) {
        return res.status(401).json({ error: "Mã PIN cũ không đúng" })
      }

      // Update with new PIN
      db.run(
        `UPDATE accounts SET pin_bcs=? WHERE class_id=?`,
        [String(new_pin), classId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message })
          res.json({ success: true, message: "Đã cập nhật mã PIN" })
        }
      )
    }
  )
})

/*
GET /api/account/profile
Get account profile including password_changed flag
*/
router.get("/profile", requireLogin, (req, res) => {
  const classId = req.session.user?.class_id
  const role = req.session.user?.role

  if (!classId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  db.get(
    `SELECT
        id,
        class_id,
        password_changed,
        password_changed_gvcn,
        password_changed_bcs,
        password_changed_codo,
        created_at
     FROM accounts
     WHERE class_id=?`,
    [classId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Account not found" })

      const rolePasswordChanged =
        role === "bancansu"
          ? row.password_changed_bcs
          : role === "co_do"
            ? row.password_changed_codo
            : role === "gvcn"
              ? row.password_changed_gvcn
              : row.password_changed

      res.json({
        id: row.id,
        class_id: row.class_id,
        role: role,
        password_changed: rolePasswordChanged === 1,
        created_at: row.created_at,
      })
    }
  )
})

module.exports = router
