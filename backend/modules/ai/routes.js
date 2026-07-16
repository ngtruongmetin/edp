const express = require("express")

const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const { buildCodoParsePreview, loadCodoDutyContext } = require("./service")

const router = express.Router()

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
      const result = await buildCodoParsePreview({
        dutyId: req.body?.dutyId,
        message: req.body?.message,
        redClass: req.session.user?.class_name,
      })

      res.json(result)
    } catch (err) {
      console.error(err)
      res.status(err.status || 500).json({ error: err.message || "Internal error" })
    }
  },
)

module.exports = router
