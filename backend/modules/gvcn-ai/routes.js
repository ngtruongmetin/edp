const express = require("express")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const { getGvcnAiReport } = require("./service")

const router = express.Router()

router.post(
  "/tasks",
  requireLogin,
  requireRole(["gvcn"]),
  async (req, res) => {
    try {
      const result = await getGvcnAiReport({
        task: String(req.body?.task || "").trim(),
        weekId: req.body?.weekId,
        requestedClassId: req.body?.classId,
        force: req.body?.force === true,
        user: req.session.user,
      })
      res.json(result)
    } catch (error) {
      console.error("[gvcn-ai/tasks]", error)
      res.status(error.status || 500).json({
        error: error.aiUnavailable
          ? error.publicMessage || "AI unavailable"
          : error.message || "Không thể phân tích dữ liệu nề nếp.",
      })
    }
  },
)

module.exports = router
