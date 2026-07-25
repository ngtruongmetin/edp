const express = require("express")

const { pool } = require("../../config/database")
const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const { buildCodoPromptPreview, loadCodoDutyContext, parseCodoMessage } = require("./service")

const router = express.Router()
const isProduction = process.env.NODE_ENV === "production"
const MAX_CHAT_HISTORY_BYTES = 500 * 1024

async function assertCodoDutyAccess(dutyId, redClass) {
  await loadCodoDutyContext({ dutyId, redClass })
}

function parseChatHistory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Dữ liệu lịch sử hội thoại không hợp lệ.")
    error.status = 400
    throw error
  }

  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, "utf8") > MAX_CHAT_HISTORY_BYTES) {
    const error = new Error("Lịch sử hội thoại vượt quá dung lượng cho phép.")
    error.status = 400
    throw error
  }

  return serialized
}

router.get(
  "/codo/history/:dutyId",
  requireLogin,
  requireRole(["co_do"]),
  async (req, res) => {
    try {
      const dutyId = Number(req.params.dutyId)
      await assertCodoDutyAccess(dutyId, req.session.user?.class_name)

      const result = await pool.query(
        `SELECT history_json FROM duty_ai_chat_histories WHERE session_id = $1 LIMIT 1`,
        [dutyId],
      )
      const stored = result.rows[0]?.history_json
      res.json({ history: stored ? JSON.parse(stored) : null })
    } catch (err) {
      console.error("[ai/codo/history:get]", err)
      res.status(err.status || 500).json({ error: err.message || "Không thể tải lịch sử hội thoại." })
    }
  },
)

router.put(
  "/codo/history/:dutyId",
  requireLogin,
  requireRole(["co_do"]),
  async (req, res) => {
    try {
      const dutyId = Number(req.params.dutyId)
      await assertCodoDutyAccess(dutyId, req.session.user?.class_name)
      const historyJson = parseChatHistory(req.body?.history)

      await pool.query(
        `
          INSERT INTO duty_ai_chat_histories (session_id, history_json, updated_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (session_id) DO UPDATE
          SET history_json = EXCLUDED.history_json,
              updated_at = EXCLUDED.updated_at
        `,
        [dutyId, historyJson, new Date().toISOString()],
      )
      res.json({ success: true })
    } catch (err) {
      console.error("[ai/codo/history:save]", err)
      res.status(err.status || 500).json({ error: err.message || "Không thể lưu lịch sử hội thoại." })
    }
  },
)

router.delete(
  "/codo/history/:dutyId",
  requireLogin,
  requireRole(["co_do"]),
  async (req, res) => {
    try {
      const dutyId = Number(req.params.dutyId)
      await assertCodoDutyAccess(dutyId, req.session.user?.class_name)
      await pool.query(`DELETE FROM duty_ai_chat_histories WHERE session_id = $1`, [dutyId])
      res.json({ success: true })
    } catch (err) {
      console.error("[ai/codo/history:delete]", err)
      res.status(err.status || 500).json({ error: err.message || "Không thể xóa lịch sử hội thoại." })
    }
  },
)

router.get(
  "/codo/context/:dutyId",
  requireLogin,
  requireRole(["co_do"]),
  async (req, res) => {
    try {
      const context = await loadCodoDutyContext({
        dutyId: req.params.dutyId,
        redClass: req.session.user?.class_name,
      })

      res.json(context)
    } catch (err) {
      console.error(err)
      res.status(err.status || 500).json({ error: err.message || "Internal error" })
    }
  },
)

router.post(
  "/codo/parse",
  requireLogin,
  requireRole(["co_do"]),
  async (req, res) => {
    try {
      const result = await parseCodoMessage({
        dutyId: req.body?.dutyId,
        message: req.body?.message,
        redClass: req.session.user?.class_name,
      })

      res.json(result)
    } catch (err) {
      console.error(err)
      if (err.invalidModelJson) {
        return res.status(err.status || 500).json({
          success: false,
          message: err.publicMessage || "Gemini trả về JSON không hợp lệ.",
          ...(isProduction ? {} : { raw: err.rawResponse || "" }),
        })
      }

      if (err.aiUnavailable) {
        return res.status(err.status || 500).json({
          success: false,
          message: err.publicMessage || "AI unavailable",
        })
      }

      res.status(err.status || 500).json({ error: err.message || "Internal error" })
    }
  },
)

router.post(
  "/codo/prompt-preview",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const result = await buildCodoPromptPreview({
        message: req.body?.message,
      })

      res.json({
        success: true,
        prompt: result.prompt,
        context: result.context,
      })
    } catch (err) {
      console.error(err)
      res.status(err.status || 500).json({ error: err.message || "Internal error" })
    }
  },
)

module.exports = router
