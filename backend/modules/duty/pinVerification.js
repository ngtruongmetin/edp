const bcrypt = require("bcrypt")
const { pool } = require("../../config/database")

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function verifyClassPin(dutyClass, providedPin) {
  const provided = String(providedPin || "").trim()
  if (!/^\d{6}$/.test(provided)) throw httpError(400, "Invalid pin")

  const result = await pool.query(
    `
      SELECT
        a.pin_ban_can_su,
        COALESCE(a.pin_failed_attempts, 0) AS pin_failed_attempts,
        COALESCE(a.pin_locked_until, 0) AS pin_locked_until,
        a.class_id AS account_class_id
      FROM classes c
      LEFT JOIN accounts a ON a.class_id = c.id
      WHERE c.name = $1
      LIMIT 1
    `,
    [dutyClass],
  )
  const row = result.rows[0]
  const expected = String(row?.pin_ban_can_su || "").trim()
  const accountClassId = Number(row?.account_class_id || 0)
  const nowMs = Date.now()

  if (!accountClassId || !expected) throw httpError(403, "Invalid pin")
  if (Number(row.pin_locked_until || 0) > nowMs) throw httpError(429, "Invalid pin")

  const matches = await bcrypt.compare(provided, expected)
  if (!matches) {
    const attempts = Number(row.pin_failed_attempts || 0) + 1
    const lockedUntil = attempts >= 5 ? nowMs + 5 * 60 * 1000 : 0
    await pool.query(
      `
        UPDATE accounts
        SET pin_failed_attempts = $1, pin_locked_until = $2
        WHERE class_id = $3
      `,
      [Math.min(attempts, 5), lockedUntil, accountClassId],
    )
    throw httpError(403, "Invalid pin")
  }

  await pool.query(
    `UPDATE accounts SET pin_failed_attempts = 0, pin_locked_until = 0 WHERE class_id = $1`,
    [accountClassId],
  )
}

module.exports = {
  httpError,
  verifyClassPin,
}
