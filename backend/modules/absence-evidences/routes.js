const express = require("express")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const { pool } = require("../../config/database")
const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const {
  applyExemptionToClosedPeriodCaches,
  recalculateWeekScores,
} = require("../../utils/absenceEvidenceScoring")

const router = express.Router()
const UPLOAD_DIRECTORY = path.join(__dirname, "..", "..", "assets", "absence-evidences")
const MAX_FILES = 5
const MAX_FILE_BYTES = 8 * 1024 * 1024
const AUTHORIZED_ABSENCE_RULE_CODE = "AUTHORIZED_ABSENCE"
const FILE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/pdf", "pdf"],
])

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
}

function isPermittedAbsenceRule(ruleCode) {
  return String(ruleCode || "").trim().toUpperCase() === AUTHORIZED_ABSENCE_RULE_CODE
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
}

function datesBetween(startDate, endDate) {
  const dates = []
  const current = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function getAbsenceDates(evidence) {
  const raw = Array.isArray(evidence?.absence_dates)
    ? evidence.absence_dates
    : typeof evidence?.absence_dates === "string"
      ? JSON.parse(evidence.absence_dates || "[]")
      : []
  const dates = [...new Set(raw.map((date) => String(date || "")).filter(isIsoDate))].sort()
  return dates.length ? dates : datesBetween(evidence.start_date, evidence.end_date)
}

function getSubmittedBy(user, className) {
  const roleLabel = user.role === "gvcn" ? "GVCN" : "Ban cán sự"
  return `${roleLabel} lớp ${className}`
}

function getReviewedBy(user) {
  return user.username ? `Quản trị viên ${user.username}` : "Quản trị viên"
}

function parseUploadedFile(file) {
  const mimeType = String(file?.type || "").toLowerCase()
  const extension = FILE_TYPES.get(mimeType)
  const dataUrl = String(file?.data || "")
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)

  if (!extension || !match || match[1].toLowerCase() !== mimeType) {
    const error = new Error("Tệp minh chứng không đúng định dạng.")
    error.status = 400
    throw error
  }

  const buffer = Buffer.from(match[2], "base64")
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    const error = new Error("Mỗi tệp minh chứng không được vượt quá 8 MB.")
    error.status = 400
    throw error
  }

  const safeName = String(file?.name || `minh-chung.${extension}`)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 160)

  return { buffer, extension, mimeType, fileName: safeName }
}

function saveFiles(files) {
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true })
  const writtenPaths = []

  try {
    const saved = files.map((file, index) => {
      const parsed = parseUploadedFile(file)
      const storedName = `${Date.now()}-${crypto.randomUUID()}.${parsed.extension}`
      const diskPath = path.join(UPLOAD_DIRECTORY, storedName)
      fs.writeFileSync(diskPath, parsed.buffer, { flag: "wx" })
      writtenPaths.push(diskPath)
      return {
        fileUrl: storedName,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sortOrder: index,
      }
    })
    return saved
  } catch (error) {
    writtenPaths.forEach((filePath) => fs.rmSync(filePath, { force: true }))
    throw error
  }
}

function removeSavedFiles(files) {
  files.forEach((file) => {
    const diskPath = path.join(UPLOAD_DIRECTORY, path.basename(file.fileUrl || ""))
    fs.rmSync(diskPath, { force: true })
  })
}

async function getClassForCurrentUser(user) {
  const classId = Number(user?.class_id)
  if (!Number.isInteger(classId) || classId < 1) return null
  const result = await pool.query(
    `SELECT id, name FROM classes WHERE id = $1 AND is_active = 1 LIMIT 1`,
    [classId],
  )
  return result.rows[0] || null
}

async function getEvidence(id) {
  const result = await pool.query(
    `
      SELECT
        evidence.*,
        classes.name AS class_name,
        weeks.week_number,
        weeks.start_date AS week_start_date,
        weeks.end_date AS week_end_date,
        (
          SELECT ticket.id
          FROM support_tickets ticket
          WHERE ticket.linked_absence_evidence_id = evidence.id
          LIMIT 1
        ) AS support_ticket_id
      FROM absence_evidences evidence
      JOIN classes ON classes.id = evidence.class_id
      JOIN schedule_weeks weeks ON weeks.id = evidence.week_id
      WHERE evidence.id = $1
      LIMIT 1
    `,
    [id],
  )
  return result.rows[0] || null
}

async function getEvidenceFiles(evidenceId) {
  const result = await pool.query(
    `
      SELECT id, file_url, file_name, mime_type, sort_order
      FROM absence_evidence_files
      WHERE evidence_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [evidenceId],
  )
  return result.rows.map(({ file_url, ...file }) => ({
    ...file,
    url: `/api/absence-evidences/files/${file.id}`,
  }))
}

async function getDutyComparison(evidence) {
  const absenceDates = getAbsenceDates(evidence)
  if (!absenceDates.length) return []
  const result = await pool.query(
    `
      SELECT
        sessions.id AS duty_session_id,
        sessions.date,
        rules.name AS absence_type,
        rules.rule_code,
        violations.id AS duty_violation_id,
        COALESCE(violations.quantity, 0) AS absence_count,
        COALESCE(SUM(logs.approved_quantity), 0) AS absence_exempted
      FROM duty_sessions sessions
      LEFT JOIN duty_violations violations ON violations.session_id = sessions.id
      LEFT JOIN rules ON rules.id = violations.rule_id
      LEFT JOIN absence_exemption_logs logs ON logs.duty_violation_id = violations.id
      WHERE sessions.week_id = $1
        AND sessions.duty_class = $2
        AND sessions.date = ANY($3::text[])
      GROUP BY sessions.id, sessions.date, rules.name, rules.rule_code, violations.id, violations.quantity
      ORDER BY sessions.date ASC, violations.id ASC
    `,
    [evidence.week_id, evidence.class_name, absenceDates],
  )

  const days = new Map(absenceDates.map((date) => [date, {
    date,
    duty_session_id: null,
    absence_type: null,
    absence_count: 0,
    absence_exempted: 0,
  }]))
  for (const row of result.rows) {
    const date = String(row.date)
    const current = days.get(date) || {
      date,
      duty_session_id: null,
      absence_type: null,
      absence_count: 0,
      absence_exempted: 0,
    }
    current.duty_session_id = Number(row.duty_session_id)
    if (!isPermittedAbsenceRule(row.rule_code)) {
      days.set(date, current)
      continue
    }
    current.absence_type = current.absence_type || row.absence_type
    current.absence_count += Number(row.absence_count || 0)
    current.absence_exempted += Number(row.absence_exempted || 0)
    days.set(date, current)
  }

  return absenceDates.map((date) => days.get(date)).map((day) => ({
    ...day,
    effective_absence: Math.max(0, day.absence_count - day.absence_exempted),
  }))
}

async function presentEvidence(evidence, includeComparison = false) {
  const result = {
    ...evidence,
    approved_exemption_count: Number(evidence.approved_exemption_count || 0),
    files: await getEvidenceFiles(evidence.id),
  }
  if (includeComparison) result.comparison = await getDutyComparison(evidence)
  return result
}

router.get(
  "/files/:fileId",
  requireLogin,
  requireRole(["admin", "gvcn", "ban_can_su"]),
  async (req, res) => {
    const fileId = Number(req.params.fileId)
    if (!Number.isInteger(fileId) || fileId < 1) {
      return res.status(400).json({ error: "Mã tệp minh chứng không hợp lệ." })
    }

    try {
      const result = await pool.query(
        `
          SELECT files.file_url, files.file_name, files.mime_type, evidence.class_id
          FROM absence_evidence_files files
          JOIN absence_evidences evidence ON evidence.id = files.evidence_id
          WHERE files.id = $1
          LIMIT 1
        `,
        [fileId],
      )
      const file = result.rows[0]
      if (!file) return res.status(404).json({ error: "Không tìm thấy tệp minh chứng." })

      const user = req.session.user
      if (user.role !== "admin" && Number(user.class_id) !== Number(file.class_id)) {
        return res.status(403).json({ error: "Bạn không có quyền xem tệp minh chứng này." })
      }

      const diskPath = path.join(UPLOAD_DIRECTORY, path.basename(file.file_url))
      if (!fs.existsSync(diskPath)) return res.status(404).json({ error: "Tệp minh chứng không còn tồn tại." })

      res.type(file.mime_type)
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
      res.sendFile(diskPath)
    } catch (error) {
      console.error("[absence-evidences/file]", error)
      res.status(500).json({ error: "Không thể tải tệp minh chứng." })
    }
  },
)

router.get(
  "/my",
  requireLogin,
  requireRole(["gvcn", "ban_can_su"]),
  async (req, res) => {
    const weekId = Number(req.query.week_id)
    if (!Number.isInteger(weekId) || weekId < 1) {
      return res.status(400).json({ error: "Tuần được chọn không hợp lệ." })
    }

    try {
      const currentClass = await getClassForCurrentUser(req.session.user)
      if (!currentClass) return res.status(403).json({ error: "Không xác định được lớp hiện tại." })
      const result = await pool.query(
        `
          SELECT
            evidence.*,
            classes.name AS class_name,
            weeks.week_number,
            weeks.start_date AS week_start_date,
            weeks.end_date AS week_end_date
          FROM absence_evidences evidence
          JOIN classes ON classes.id = evidence.class_id
          JOIN schedule_weeks weeks ON weeks.id = evidence.week_id
          WHERE evidence.class_id = $1
            AND evidence.week_id = $2
          ORDER BY evidence.submitted_at DESC, evidence.id DESC
        `,
        [currentClass.id, weekId],
      )
      const evidences = await Promise.all(result.rows.map((row) => presentEvidence(row)))
      res.json({ evidences })
    } catch (error) {
      console.error("[absence-evidences/my]", error)
      res.status(500).json({ error: "Không thể tải danh sách minh chứng." })
    }
  },
)

router.post(
  "/",
  requireLogin,
  requireRole(["gvcn", "ban_can_su"]),
  async (req, res) => {
    const weekId = Number(req.body?.week_id)
    const studentName = String(req.body?.student_name || "").trim()
    const legacyStartDate = String(req.body?.start_date || "")
    const legacyEndDate = String(req.body?.end_date || "")
    const requestedDates = Array.isArray(req.body?.absence_dates)
      ? [...new Set(req.body.absence_dates.map((date) => String(date || "")))].sort()
      : null
    const note = String(req.body?.note || "").trim().slice(0, 2000)
    const files = Array.isArray(req.body?.files) ? req.body.files : []

    if (!Number.isInteger(weekId) || weekId < 1 || !studentName || studentName.length > 160) {
      return res.status(400).json({ error: "Thông tin học sinh hoặc tuần chưa hợp lệ." })
    }
    if (!files.length) return res.status(400).json({ error: "Vui lòng tải ít nhất một tệp minh chứng." })
    if (files.length > MAX_FILES) return res.status(400).json({ error: "Bạn chỉ được tải tối đa 5 tệp." })

    let savedFiles = []
    try {
      const currentClass = await getClassForCurrentUser(req.session.user)
      if (!currentClass) return res.status(403).json({ error: "Không xác định được lớp hiện tại." })
      const weekResult = await pool.query(
        `SELECT id, start_date, end_date FROM schedule_weeks WHERE id = $1 LIMIT 1`,
        [weekId],
      )
      const week = weekResult.rows[0]
      if (!week) return res.status(400).json({ error: "Tuần được chọn không tồn tại." })

      const absenceDates = requestedDates === null
        ? isIsoDate(legacyStartDate) && isIsoDate(legacyEndDate) && legacyStartDate <= legacyEndDate
          ? datesBetween(legacyStartDate, legacyEndDate)
          : []
        : requestedDates
      if (!absenceDates.length || absenceDates.some((date) => !isIsoDate(date) || date < week.start_date || date > week.end_date)) {
        return res.status(400).json({ error: "Vui lòng chọn ít nhất một ngày nghỉ trong tuần." })
      }
      const startDate = absenceDates[0]
      const endDate = absenceDates[absenceDates.length - 1]

      savedFiles = saveFiles(files)
      const now = new Date().toISOString()
      const client = await pool.connect()
      let evidenceId
      try {
        await client.query("BEGIN")
        const insertEvidence = await client.query(
          `
            INSERT INTO absence_evidences
            (class_id, student_name, week_id, start_date, end_date, absence_dates, note, status, submitted_by, submitted_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', $8, $9)
            RETURNING id
          `,
          [currentClass.id, studentName, weekId, startDate, endDate, JSON.stringify(absenceDates), note, getSubmittedBy(req.session.user, currentClass.name), now],
        )
        evidenceId = insertEvidence.rows[0].id
        for (const file of savedFiles) {
          await client.query(
            `
              INSERT INTO absence_evidence_files
              (evidence_id, file_url, file_name, mime_type, sort_order)
              VALUES ($1, $2, $3, $4, $5)
            `,
            [evidenceId, file.fileUrl, file.fileName, file.mimeType, file.sortOrder],
          )
        }
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }

      const evidence = await getEvidence(evidenceId)
      res.status(201).json({ evidence: await presentEvidence(evidence) })
    } catch (error) {
      if (savedFiles.length) removeSavedFiles(savedFiles)
      console.error("[absence-evidences/create]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể gửi minh chứng." })
    }
  },
)

router.delete(
  "/:id",
  requireLogin,
  requireRole(["gvcn", "ban_can_su"]),
  async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Mã minh chứng không hợp lệ." })
    }

    try {
      const currentClass = await getClassForCurrentUser(req.session.user)
      if (!currentClass) return res.status(403).json({ error: "Không xác định được lớp hiện tại." })

      const client = await pool.connect()
      let files = []
      try {
        await client.query("BEGIN")
        const evidenceResult = await client.query(
          `
            SELECT id, status
            FROM absence_evidences
            WHERE id = $1 AND class_id = $2
            FOR UPDATE
          `,
          [id, currentClass.id],
        )
        const evidence = evidenceResult.rows[0]
        if (!evidence) {
          const error = new Error("Không tìm thấy minh chứng.")
          error.status = 404
          throw error
        }
        if (!["pending", "rejected"].includes(evidence.status)) {
          const error = new Error("Chỉ được xóa minh chứng chờ duyệt hoặc đã từ chối.")
          error.status = 409
          throw error
        }

        const fileResult = await client.query(
          `SELECT file_url FROM absence_evidence_files WHERE evidence_id = $1`,
          [id],
        )
        files = fileResult.rows.map((file) => ({ fileUrl: file.file_url }))
        await client.query(`DELETE FROM absence_evidences WHERE id = $1`, [id])
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }

      removeSavedFiles(files)
      res.json({ success: true })
    } catch (error) {
      console.error("[absence-evidences/delete]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể xóa minh chứng." })
    }
  },
)

router.delete(
  "/admin/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Mã minh chứng không hợp lệ." })
    }

    let evidence
    let files = []
    let scoreAdjustment = 0

    try {
      const client = await pool.connect()
      let committed = false
      try {
        await client.query("BEGIN")
        const evidenceResult = await client.query(
          `
            SELECT evidence.*, classes.name AS class_name
            FROM absence_evidences evidence
            JOIN classes ON classes.id = evidence.class_id
            WHERE evidence.id = $1
            FOR UPDATE
          `,
          [id],
        )
        evidence = evidenceResult.rows[0]
        if (!evidence) {
          const error = new Error("Không tìm thấy minh chứng.")
          error.status = 404
          throw error
        }

        const exemptionResult = await client.query(
          `
            SELECT COALESCE(SUM(-COALESCE(violations.score_delta_snapshot, rules.score_delta) * logs.approved_quantity), 0) AS score_adjustment
            FROM absence_exemption_logs logs
            JOIN duty_violations violations ON violations.id = logs.duty_violation_id
            JOIN rules ON rules.id = violations.rule_id
            WHERE logs.evidence_id = $1
          `,
          [id],
        )
        scoreAdjustment = Number(exemptionResult.rows[0]?.score_adjustment || 0)

        const fileResult = await client.query(
          `SELECT file_url FROM absence_evidence_files WHERE evidence_id = $1`,
          [id],
        )
        files = fileResult.rows.map((file) => ({ fileUrl: file.file_url }))

        await client.query(`DELETE FROM absence_exemption_logs WHERE evidence_id = $1`, [id])
        await client.query(`DELETE FROM absence_evidences WHERE id = $1`, [id])
        if (scoreAdjustment) {
          await recalculateWeekScores(Number(evidence.week_id), client)
          await applyExemptionToClosedPeriodCaches(
            Number(evidence.week_id),
            evidence.class_name,
            -scoreAdjustment,
            client,
          )
        }
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }

      removeSavedFiles(files)
      res.json({ success: true, recalculated: Boolean(scoreAdjustment) })
    } catch (error) {
      console.error("[absence-evidences/admin/delete]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể xóa minh chứng." })
    }
  },
)

router.get(
  "/admin",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const status = String(req.query.status || "").trim()
    const weekId = req.query.week_id ? Number(req.query.week_id) : null
    if (status && !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Trạng thái lọc không hợp lệ." })
    }
    if (req.query.week_id && (!Number.isInteger(weekId) || weekId < 1)) {
      return res.status(400).json({ error: "Tuần được chọn không hợp lệ." })
    }

    try {
      const conditions = []
      const values = []
      if (status) {
        values.push(status)
        conditions.push(`evidence.status = $${values.length}`)
      }
      if (weekId) {
        values.push(weekId)
        conditions.push(`evidence.week_id = $${values.length}`)
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
      const result = await pool.query(
        `
          SELECT
            evidence.id,
            evidence.student_name,
            evidence.start_date,
            evidence.end_date,
            evidence.status,
            evidence.submitted_by,
            evidence.submitted_at,
            evidence.approved_exemption_count,
            classes.name AS class_name,
            weeks.week_number
          FROM absence_evidences evidence
          JOIN classes ON classes.id = evidence.class_id
          JOIN schedule_weeks weeks ON weeks.id = evidence.week_id
          ${where}
          ORDER BY
            CASE evidence.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
            evidence.submitted_at DESC,
            evidence.id DESC
        `,
        values,
      )
      res.json({ evidences: result.rows })
    } catch (error) {
      console.error("[absence-evidences/admin/list]", error)
      res.status(500).json({ error: "Không thể tải danh sách minh chứng." })
    }
  },
)

router.get(
  "/admin/:id",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Mã minh chứng không hợp lệ." })

    try {
      const evidence = await getEvidence(id)
      if (!evidence) return res.status(404).json({ error: "Không tìm thấy minh chứng." })
      res.json({ evidence: await presentEvidence(evidence, true) })
    } catch (error) {
      console.error("[absence-evidences/admin/detail]", error)
      res.status(500).json({ error: "Không thể tải chi tiết minh chứng." })
    }
  },
)

router.post(
  "/admin/:id/support-message",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const id = Number(req.params.id)
    const body = String(req.body?.body || "").trim()
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Mã minh chứng không hợp lệ." })
    if (!body || body.length > 5000) {
      return res.status(400).json({ error: "Nội dung phản hồi phải có từ 1 đến 5000 ký tự." })
    }

    try {
      const client = await pool.connect()
      let ticketId
      try {
        await client.query("BEGIN")
        const evidenceResult = await client.query(
          `
            SELECT evidence.*, classes.name AS class_name
            FROM absence_evidences evidence
            JOIN classes ON classes.id = evidence.class_id
            WHERE evidence.id = $1
            FOR UPDATE
          `,
          [id],
        )
        const evidence = evidenceResult.rows[0]
        if (!evidence) {
          const error = new Error("Không tìm thấy minh chứng.")
          error.status = 404
          throw error
        }
        if (evidence.status !== "pending") {
          const error = new Error("Chỉ có thể phản hồi minh chứng đang chờ duyệt.")
          error.status = 409
          throw error
        }

        const existingTicket = await client.query(
          `SELECT id FROM support_tickets WHERE linked_absence_evidence_id = $1 FOR UPDATE`,
          [id],
        )
        if (existingTicket.rows[0]) {
          ticketId = existingTicket.rows[0].id
        } else {
          const now = new Date().toISOString()
          const createdTicket = await client.query(
            `
              INSERT INTO support_tickets
              (creator_role, creator_class_id, title, request_type, status, linked_absence_evidence_id, created_at, updated_at)
              VALUES ('gvcn', $1, $2, 'absence_evidence', 'in_progress', $3, $4, $4)
              RETURNING id
            `,
            [evidence.class_id, `Minh chứng nghỉ học: ${evidence.student_name}`, id, now],
          )
          ticketId = createdTicket.rows[0].id
        }

        const now = new Date().toISOString()
        const messageResult = await client.query(
          `
            INSERT INTO support_messages (ticket_id, sender_role, sender_class_id, body, created_at)
            VALUES ($1, 'admin', NULL, $2, $3)
            RETURNING id
          `,
          [ticketId, body, now],
        )
        await client.query(`UPDATE support_tickets SET updated_at = $1 WHERE id = $2`, [now, ticketId])
        await client.query(
          `
            INSERT INTO support_notifications
            (ticket_id, message_id, recipient_role, recipient_class_id, is_read, created_at)
            VALUES ($1, $2, 'gvcn', $3, 0, $4)
          `,
          [ticketId, messageResult.rows[0].id, evidence.class_id, now],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }

      const updatedEvidence = await getEvidence(id)
      res.status(201).json({ evidence: await presentEvidence(updatedEvidence, true), ticket_id: ticketId })
    } catch (error) {
      console.error("[absence-evidences/admin/support-message]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể gửi phản hồi cho GVCN." })
    }
  },
)

router.post(
  "/admin/:id/review",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    const id = Number(req.params.id)
    const action = String(req.body?.action || "")
    const reviewReason = String(req.body?.review_reason || "").trim()
    const requestedApprovalDates = Array.isArray(req.body?.approved_dates)
      ? [...new Set(req.body.approved_dates.map((date) => String(date || "")))]
      : null
    if (!Number.isInteger(id) || id < 1 || !["pending", "approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "Yêu cầu duyệt minh chứng không hợp lệ." })
    }
    if (action === "rejected" && !reviewReason) {
      return res.status(400).json({ error: "Vui lòng nhập lý do từ chối." })
    }
    if (reviewReason.length > 2000) {
      return res.status(400).json({ error: "Lý do từ chối không được vượt quá 2000 ký tự." })
    }
    if (requestedApprovalDates && requestedApprovalDates.some((date) => !isIsoDate(date))) {
      return res.status(400).json({ error: "Ngày miễn trừ không hợp lệ." })
    }

    let evidence
    let scoreAdjustment = 0
    try {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const evidenceResult = await client.query(
          `
            SELECT evidence.*, classes.name AS class_name
            FROM absence_evidences evidence
            JOIN classes ON classes.id = evidence.class_id
            WHERE evidence.id = $1
            FOR UPDATE
          `,
          [id],
        )
        evidence = evidenceResult.rows[0]
        if (!evidence) {
          const error = new Error("Không tìm thấy minh chứng.")
          error.status = 404
          throw error
        }
        if (action === "pending") {
          if (evidence.status !== "rejected") {
            const error = new Error("Chỉ có thể duyệt lại minh chứng đã bị từ chối.")
            error.status = 409
            throw error
          }

          await client.query(
            `
              UPDATE absence_evidences
              SET status = 'pending',
                  reviewed_by = NULL,
                  reviewed_at = NULL,
                  review_reason = NULL,
                  approved_exemption_count = 0
              WHERE id = $1
            `,
            [id],
          )
          await client.query("COMMIT")
          committed = true
          const updatedEvidence = await getEvidence(id)
          return res.json({ evidence: await presentEvidence(updatedEvidence, true) })
        }

        if (evidence.status !== "pending") {
          const error = new Error("Minh chứng này đã được xử lý.")
          error.status = 409
          throw error
        }

        let approvedCount = 0
        if (action === "approved") {
          const absenceDates = getAbsenceDates(evidence)
          const candidates = await client.query(
            `
              SELECT
                sessions.id AS duty_session_id,
                sessions.date,
                violations.id AS duty_violation_id,
                violations.quantity,
                rules.name AS absence_type,
                rules.rule_code,
                COALESCE(violations.score_delta_snapshot, rules.score_delta) AS score_delta,
                COALESCE(SUM(logs.approved_quantity), 0) AS already_exempted
              FROM duty_sessions sessions
              JOIN duty_violations violations ON violations.session_id = sessions.id
              JOIN rules ON rules.id = violations.rule_id
              LEFT JOIN absence_exemption_logs logs ON logs.duty_violation_id = violations.id
              WHERE sessions.week_id = $1
                AND sessions.duty_class = $2
                AND sessions.date = ANY($3::text[])
              GROUP BY sessions.id, sessions.date, violations.id, violations.quantity, rules.name, rules.rule_code, violations.score_delta_snapshot, rules.score_delta
              ORDER BY sessions.date ASC, violations.id ASC
            `,
            [evidence.week_id, evidence.class_name, absenceDates],
          )

          const perDate = new Map()
          for (const row of candidates.rows) {
            if (!isPermittedAbsenceRule(row.rule_code)) continue
            const available = Math.max(0, Number(row.quantity || 0) - Number(row.already_exempted || 0))
            if (!available) continue
            const dateRows = perDate.get(row.date) || []
            dateRows.push(row)
            perDate.set(row.date, dateRows)
          }

          const selectedDates = requestedApprovalDates === null
            ? new Set(perDate.keys())
            : new Set(requestedApprovalDates)
          if (!selectedDates.size) {
            const error = new Error("Chọn ít nhất một ngày có lỗi để miễn trừ.")
            error.status = 400
            throw error
          }
          for (const date of selectedDates) {
            if (!perDate.has(date)) {
              const error = new Error("Có ngày được chọn không còn lỗi Vắng có phép để miễn trừ.")
              error.status = 409
              throw error
            }
          }

          for (const [date, rows] of perDate.entries()) {
            if (!selectedDates.has(date)) continue
            let remainingForStudent = 1
            for (const row of rows) {
              const available = Math.max(0, Number(row.quantity || 0) - Number(row.already_exempted || 0))
              const quantity = Math.min(remainingForStudent, available)
              if (!quantity) continue
              await client.query(
                `
                  INSERT INTO absence_exemption_logs
                  (evidence_id, duty_session_id, duty_violation_id, absence_type, approved_quantity, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [id, row.duty_session_id, row.duty_violation_id, row.absence_type, quantity, new Date().toISOString()],
              )
              approvedCount += quantity
              scoreAdjustment += -Number(row.score_delta || 0) * quantity
              remainingForStudent -= quantity
              if (!remainingForStudent) break
            }
          }
        }

        const reviewedAt = new Date().toISOString()
        await client.query(
          `
            UPDATE absence_evidences
            SET status = $1,
                reviewed_by = $2,
                reviewed_at = $3,
                review_reason = $4,
                approved_exemption_count = $5
            WHERE id = $6
          `,
          [action, getReviewedBy(req.session.user), reviewedAt, action === "rejected" ? reviewReason : null, approvedCount, id],
        )
        if (action === "approved") {
          await recalculateWeekScores(Number(evidence.week_id), client)
          await applyExemptionToClosedPeriodCaches(
            Number(evidence.week_id),
            evidence.class_name,
            scoreAdjustment,
            client,
          )
        }
        await client.query("COMMIT")
        committed = true
      } catch (error) {
        if (!committed) await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }

      const updatedEvidence = await getEvidence(id)
      res.json({ evidence: await presentEvidence(updatedEvidence, true) })
    } catch (error) {
      console.error("[absence-evidences/admin/review]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể xử lý minh chứng." })
    }
  },
)

module.exports = router
