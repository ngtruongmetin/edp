const crypto = require("crypto")
const express = require("express")
const fs = require("fs")
const path = require("path")

const { pool } = require("../../config/database")
const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

const router = express.Router()
const USER_ROLES = ["gvcn", "ban_can_su", "co_do"]
const REQUEST_TYPES = ["duty_complaint", "system_bug", "suggestion", "usage_support", "other"]
const TICKET_STATUSES = ["in_progress", "resolved"]
const MAX_FILES = 5
const MAX_FILE_BYTES = 8 * 1024 * 1024
const UPLOAD_DIRECTORY = path.join(__dirname, "..", "..", "assets", "support")
const FILE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/pdf", "pdf"],
])

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseId(value, label) {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) throw httpError(400, `${label} không hợp lệ.`)
  return id
}

function parseFiles(value) {
  const files = Array.isArray(value) ? value : []
  if (files.length > MAX_FILES) throw httpError(400, "Chỉ được đính kèm tối đa 5 tệp cho mỗi tin nhắn.")
  return files
}

function parseUploadedFile(file) {
  const mimeType = String(file?.type || "").toLowerCase()
  const extension = FILE_TYPES.get(mimeType)
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(file?.data || ""))
  if (!extension || !match || match[1].toLowerCase() !== mimeType) {
    throw httpError(400, "Tệp đính kèm chỉ hỗ trợ JPG, JPEG, PNG hoặc PDF.")
  }

  const buffer = Buffer.from(match[2], "base64")
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    throw httpError(400, "Mỗi tệp đính kèm không được vượt quá 8 MB.")
  }

  const safeName = String(file?.name || `tep-dinh-kem.${extension}`)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 160)

  return { buffer, extension, mimeType, fileName: safeName }
}

function saveFiles(files) {
  if (!files.length) return []
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true })
  const diskPaths = []
  try {
    return files.map((file, index) => {
      const parsed = parseUploadedFile(file)
      const storedName = `${Date.now()}-${crypto.randomUUID()}.${parsed.extension}`
      const diskPath = path.join(UPLOAD_DIRECTORY, storedName)
      fs.writeFileSync(diskPath, parsed.buffer, { flag: "wx" })
      diskPaths.push(diskPath)
      return {
        filePath: storedName,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sortOrder: index,
      }
    })
  } catch (error) {
    diskPaths.forEach((diskPath) => fs.rmSync(diskPath, { force: true }))
    throw error
  }
}

function removeSavedFiles(files) {
  files.forEach((file) => {
    fs.rmSync(path.join(UPLOAD_DIRECTORY, path.basename(file.filePath || "")), { force: true })
  })
}

function userCanCreate(user) {
  return USER_ROLES.includes(String(user?.role || ""))
}

function isOwner(ticket, user) {
  return ticket.creator_role === user.role && Number(ticket.creator_class_id) === Number(user.class_id)
}

function getRoleLabel(role) {
  const labels = {
    admin: "Quản trị viên",
    gvcn: "Giáo viên chủ nhiệm",
    ban_can_su: "Ban cán sự",
    co_do: "Cờ đỏ",
  }
  return labels[role] || role
}

function getMessageSenderLabel(message) {
  if (message.sender_role === "admin") return "Quản trị viên"

  const labels = {
    gvcn: "GVCN",
    ban_can_su: "Ban cán sự",
    co_do: "Cờ đỏ",
  }
  const roleLabel = labels[message.sender_role] || getRoleLabel(message.sender_role)
  return message.sender_class_name ? `${roleLabel} • ${message.sender_class_name}` : roleLabel
}

async function getTicket(ticketId) {
  const result = await pool.query(
    `
      SELECT
        ticket.*,
        classes.name AS creator_class_name,
        weeks.week_number AS linked_week_number,
        sessions.date AS linked_duty_date,
        sessions.red_class AS linked_red_class,
        sessions.duty_class AS linked_duty_class
      FROM support_tickets ticket
      JOIN classes ON classes.id = ticket.creator_class_id
      LEFT JOIN schedule_weeks weeks ON weeks.id = ticket.linked_week_id
      LEFT JOIN duty_sessions sessions ON sessions.id = ticket.linked_duty_session_id
      WHERE ticket.id = $1
      LIMIT 1
    `,
    [ticketId],
  )
  return result.rows[0] || null
}

async function getAttachments(messageId) {
  const result = await pool.query(
    `
      SELECT id, file_name, mime_type, sort_order
      FROM support_attachments
      WHERE message_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [messageId],
  )
  return result.rows.map((file) => ({ ...file, url: `/api/support/files/${file.id}` }))
}

async function presentTicket(ticket, includeMessages = false) {
  const result = { ...ticket }
  if (!includeMessages) return result

  const messageResult = await pool.query(
    `
      SELECT message.id, message.ticket_id, message.sender_role, message.sender_class_id,
             message.body, message.created_at, classes.name AS sender_class_name
      FROM support_messages message
      LEFT JOIN classes ON classes.id = message.sender_class_id
      WHERE message.ticket_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [ticket.id],
  )
  result.messages = await Promise.all(messageResult.rows.map(async (message) => ({
    ...message,
    sender_label: getMessageSenderLabel(message),
    attachments: await getAttachments(message.id),
  })))
  return result
}

async function validateDutyLink({ user, weekId, sessionId }) {
  if (!weekId && !sessionId) return { weekId: null, sessionId: null }
  if (!weekId || !sessionId) {
    throw httpError(400, "Vui lòng chọn đầy đủ tuần và Phiếu trực cần khiếu nại.")
  }

  const result = await pool.query(
    `
      SELECT sessions.id, sessions.week_id
      FROM duty_sessions sessions
      WHERE sessions.id = $1
        AND sessions.week_id = $2
        AND (sessions.red_class = $3 OR sessions.duty_class = $3)
      LIMIT 1
    `,
    [sessionId, weekId, user.class_name],
  )
  if (!result.rows[0]) {
    throw httpError(400, "Phiếu trực được chọn không thuộc tuần hoặc lớp hiện tại.")
  }
  return { weekId, sessionId }
}

async function createNotification(client, { ticketId, messageId, recipientRole, recipientClassId, now }) {
  await client.query(
    `
      INSERT INTO support_notifications
      (ticket_id, message_id, recipient_role, recipient_class_id, is_read, created_at)
      VALUES ($1, $2, $3, $4, 0, $5)
    `,
    [ticketId, messageId, recipientRole, recipientClassId || null, now],
  )
}

async function assertTicketAccess(ticketId, user) {
  const ticket = await getTicket(ticketId)
  if (!ticket) throw httpError(404, "Không tìm thấy yêu cầu hỗ trợ.")
  if (user.role !== "admin" && !isOwner(ticket, user)) {
    throw httpError(403, "Bạn không có quyền xem yêu cầu hỗ trợ này.")
  }
  return ticket
}

router.get("/notifications/unread-count", requireLogin, async (req, res) => {
  try {
    const user = req.session.user
    const params = user.role === "admin" ? ["admin"] : [user.role, user.class_id]
    const where = user.role === "admin"
      ? "recipient_role = $1"
      : "recipient_role = $1 AND recipient_class_id = $2"
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM support_notifications WHERE ${where} AND is_read = 0`,
      params,
    )
    res.json({ count: Number(result.rows[0]?.count || 0) })
  } catch (error) {
    console.error("[support/unread-count]", error)
    res.status(500).json({ error: "Không thể tải thông báo hỗ trợ." })
  }
})

router.get("/meta", requireLogin, async (req, res) => {
  try {
    const user = req.session.user
    const weekResult = await pool.query(
      `SELECT id, week_number, start_date, end_date FROM schedule_weeks ORDER BY week_number DESC, id DESC LIMIT 30`,
    )
    const result = { weeks: weekResult.rows, classes: [] }
    if (user.role === "admin") {
      const classResult = await pool.query(`SELECT id, name, grade FROM classes WHERE is_active = 1 ORDER BY grade, name`)
      result.classes = classResult.rows
    }
    res.json(result)
  } catch (error) {
    console.error("[support/meta]", error)
    res.status(500).json({ error: "Không thể tải dữ liệu hỗ trợ." })
  }
})

router.get("/duty-sessions", requireLogin, requireRole(USER_ROLES), async (req, res) => {
  try {
    const weekId = parseId(req.query.week_id, "Tuần")
    const result = await pool.query(
      `
        SELECT id, week_id, date, red_class, duty_class, status
        FROM duty_sessions
        WHERE week_id = $1 AND (red_class = $2 OR duty_class = $2)
        ORDER BY date DESC, id DESC
      `,
      [weekId, req.session.user.class_name],
    )
    res.json({ sessions: result.rows })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Không thể tải Phiếu trực." })
  }
})

router.get("/admin", requireLogin, requireRole(["admin"]), async (req, res) => {
  try {
    const role = String(req.query.role || "").trim()
    const classId = req.query.class_id ? parseId(req.query.class_id, "Lớp") : null
    const requestType = String(req.query.request_type || "").trim()
    const status = String(req.query.status || "").trim()
    const search = String(req.query.search || "").trim().slice(0, 160)

    if (role && !USER_ROLES.includes(role)) throw httpError(400, "Vai trò lọc không hợp lệ.")
    if (requestType && !REQUEST_TYPES.includes(requestType)) throw httpError(400, "Loại yêu cầu lọc không hợp lệ.")
    if (status && !TICKET_STATUSES.includes(status)) throw httpError(400, "Trạng thái lọc không hợp lệ.")

    const filters = []
    const values = []
    if (role) { values.push(role); filters.push(`ticket.creator_role = $${values.length}`) }
    if (classId) { values.push(classId); filters.push(`ticket.creator_class_id = $${values.length}`) }
    if (requestType) { values.push(requestType); filters.push(`ticket.request_type = $${values.length}`) }
    if (status) { values.push(status); filters.push(`ticket.status = $${values.length}`) }
    if (search) {
      values.push(`%${search}%`)
      filters.push(`(ticket.title ILIKE $${values.length} OR classes.name ILIKE $${values.length})`)
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    const result = await pool.query(
      `
        SELECT ticket.*, classes.name AS creator_class_name,
          EXISTS (
            SELECT 1 FROM support_notifications notification
            WHERE notification.ticket_id = ticket.id
              AND notification.recipient_role = 'admin'
              AND notification.is_read = 0
          ) AS has_new_response
        FROM support_tickets ticket
        JOIN classes ON classes.id = ticket.creator_class_id
        ${where}
        ORDER BY
          CASE ticket.status WHEN 'in_progress' THEN 0 ELSE 1 END,
          ticket.updated_at DESC,
          ticket.id DESC
      `,
      values,
    )
    res.json({ tickets: result.rows })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Không thể tải yêu cầu hỗ trợ." })
  }
})

router.get("/my", requireLogin, requireRole(USER_ROLES), async (req, res) => {
  try {
    const user = req.session.user
    const result = await pool.query(
      `
        SELECT ticket.*, classes.name AS creator_class_name,
          EXISTS (
            SELECT 1 FROM support_notifications notification
            WHERE notification.ticket_id = ticket.id
              AND notification.recipient_role = $1
              AND notification.recipient_class_id = $2
              AND notification.is_read = 0
          ) AS has_new_response
        FROM support_tickets ticket
        JOIN classes ON classes.id = ticket.creator_class_id
        WHERE ticket.creator_role = $1 AND ticket.creator_class_id = $2
        ORDER BY ticket.updated_at DESC, ticket.id DESC
      `,
      [user.role, user.class_id],
    )
    res.json({ tickets: result.rows })
  } catch (error) {
    console.error("[support/my]", error)
    res.status(500).json({ error: "Không thể tải yêu cầu hỗ trợ." })
  }
})

router.post("/", requireLogin, requireRole(USER_ROLES), async (req, res) => {
  let savedFiles = []
  let files = []
  try {
    files = parseFiles(req.body?.files)
    const user = req.session.user
    const title = String(req.body?.title || "").trim()
    const requestType = String(req.body?.request_type || "").trim()
    const body = String(req.body?.body || "").trim()
    if (!title || title.length > 200) throw httpError(400, "Tiêu đề phải có từ 1 đến 200 ký tự.")
    if (!REQUEST_TYPES.includes(requestType)) throw httpError(400, "Loại yêu cầu không hợp lệ.")
    if (!body || body.length > 5000) throw httpError(400, "Nội dung phải có từ 1 đến 5000 ký tự.")

    const weekId = req.body?.linked_week_id ? parseId(req.body.linked_week_id, "Tuần") : null
    const sessionId = req.body?.linked_duty_session_id ? parseId(req.body.linked_duty_session_id, "Phiếu trực") : null
    const linked = requestType === "duty_complaint"
      ? await validateDutyLink({ user, weekId, sessionId })
      : { weekId: null, sessionId: null }

    savedFiles = saveFiles(files)
    const now = new Date().toISOString()
    const client = await pool.connect()
    let ticketId
    try {
      await client.query("BEGIN")
      const ticketResult = await client.query(
        `
          INSERT INTO support_tickets
          (creator_role, creator_class_id, title, request_type, status, linked_week_id, linked_duty_session_id, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'in_progress', $5, $6, $7, $7)
          RETURNING id
        `,
        [user.role, user.class_id, title, requestType, linked.weekId, linked.sessionId, now],
      )
      ticketId = ticketResult.rows[0].id
      const messageResult = await client.query(
        `INSERT INTO support_messages (ticket_id, sender_role, sender_class_id, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ticketId, user.role, user.class_id, body, now],
      )
      const messageId = messageResult.rows[0].id
      for (const file of savedFiles) {
        await client.query(
          `INSERT INTO support_attachments (message_id, file_path, file_name, mime_type, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [messageId, file.filePath, file.fileName, file.mimeType, file.sortOrder, now],
        )
      }
      await createNotification(client, { ticketId, messageId, recipientRole: "admin", now })
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
    const ticket = await getTicket(ticketId)
    res.status(201).json({ ticket: await presentTicket(ticket, true) })
  } catch (error) {
    if (savedFiles.length) removeSavedFiles(savedFiles)
    res.status(error.status || 500).json({ error: error.message || "Không thể tạo yêu cầu hỗ trợ." })
  }
})

router.get("/files/:fileId", requireLogin, async (req, res) => {
  try {
    const fileId = parseId(req.params.fileId, "Tệp đính kèm")
    const result = await pool.query(
      `
        SELECT attachment.file_path, attachment.file_name, attachment.mime_type,
               ticket.creator_role, ticket.creator_class_id
        FROM support_attachments attachment
        JOIN support_messages message ON message.id = attachment.message_id
        JOIN support_tickets ticket ON ticket.id = message.ticket_id
        WHERE attachment.id = $1
        LIMIT 1
      `,
      [fileId],
    )
    const file = result.rows[0]
    if (!file) throw httpError(404, "Không tìm thấy tệp đính kèm.")
    const user = req.session.user
    if (user.role !== "admin" && (file.creator_role !== user.role || Number(file.creator_class_id) !== Number(user.class_id))) {
      throw httpError(403, "Bạn không có quyền xem tệp đính kèm này.")
    }
    const diskPath = path.join(UPLOAD_DIRECTORY, path.basename(file.file_path))
    if (!fs.existsSync(diskPath)) throw httpError(404, "Tệp đính kèm không còn tồn tại.")
    res.type(file.mime_type)
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
    res.sendFile(diskPath)
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Không thể mở tệp đính kèm." })
  }
})

router.get("/:id", requireLogin, async (req, res) => {
  try {
    const ticketId = parseId(req.params.id, "Yêu cầu hỗ trợ")
    const user = req.session.user
    const ticket = await assertTicketAccess(ticketId, user)
    const where = user.role === "admin"
      ? "ticket_id = $1 AND recipient_role = 'admin' AND is_read = 0"
      : "ticket_id = $1 AND recipient_role = $2 AND recipient_class_id = $3 AND is_read = 0"
    const params = user.role === "admin" ? [ticketId] : [ticketId, user.role, user.class_id]
    await pool.query(`UPDATE support_notifications SET is_read = 1 WHERE ${where}`, params)
    res.json({ ticket: await presentTicket(ticket, true) })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Không thể tải chi tiết yêu cầu hỗ trợ." })
  }
})

router.post("/:id/messages", requireLogin, async (req, res) => {
  let savedFiles = []
  let files = []
  try {
    files = parseFiles(req.body?.files)
    const ticketId = parseId(req.params.id, "Yêu cầu hỗ trợ")
    const user = req.session.user
    if (user.role !== "admin" && !userCanCreate(user)) throw httpError(403, "Bạn không có quyền gửi phản hồi.")
    const body = String(req.body?.body || "").trim()
    if (!body || body.length > 5000) throw httpError(400, "Nội dung phản hồi phải có từ 1 đến 5000 ký tự.")
    const ticket = await assertTicketAccess(ticketId, user)
    savedFiles = saveFiles(files)
    const now = new Date().toISOString()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const messageResult = await client.query(
        `INSERT INTO support_messages (ticket_id, sender_role, sender_class_id, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ticketId, user.role, user.role === "admin" ? null : user.class_id, body, now],
      )
      const messageId = messageResult.rows[0].id
      for (const file of savedFiles) {
        await client.query(
          `INSERT INTO support_attachments (message_id, file_path, file_name, mime_type, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [messageId, file.filePath, file.fileName, file.mimeType, file.sortOrder, now],
        )
      }
      const nextStatus = user.role === "admin" ? "resolved" : "in_progress"
      await client.query(`UPDATE support_tickets SET status = $1, updated_at = $2 WHERE id = $3`, [nextStatus, now, ticketId])
      if (user.role === "admin") {
        await createNotification(client, {
          ticketId,
          messageId,
          recipientRole: ticket.creator_role,
          recipientClassId: ticket.creator_class_id,
          now,
        })
      } else {
        await createNotification(client, { ticketId, messageId, recipientRole: "admin", now })
      }
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
    const updated = await getTicket(ticketId)
    res.status(201).json({ ticket: await presentTicket(updated, true) })
  } catch (error) {
    if (savedFiles.length) removeSavedFiles(savedFiles)
    res.status(error.status || 500).json({ error: error.message || "Không thể gửi phản hồi." })
  }
})

module.exports = router
