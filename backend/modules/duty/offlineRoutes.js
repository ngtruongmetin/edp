const crypto = require("crypto")
const express = require("express")
const fs = require("fs")
const multer = require("multer")

const { pool } = require("../../config/database")
const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")
const time = require("../../utils/time")
const {
  DUTY_EVIDENCE_DIRECTORY,
  DUTY_EVIDENCE_LIMIT,
  DUTY_EVIDENCE_MAX_BYTES,
  DUTY_EVIDENCE_TYPES,
  DUTY_SIGNATURE_DIRECTORY,
  sanitizeDutyEvidenceFileName,
  writeDutyImage,
} = require("./dutyFiles")
const { httpError } = require("./pinVerification")

const router = express.Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: DUTY_EVIDENCE_MAX_BYTES },
  fileFilter(_req, file, callback) {
    if (!DUTY_EVIDENCE_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      return callback(httpError(400, "Ảnh chỉ hỗ trợ JPG, PNG hoặc WebP."))
    }
    callback(null, true)
  },
})

router.use(requireLogin, requireRole(["co_do"]))

function assertUuid(value, fieldName) {
  const normalized = String(value || "").trim()
  if (!UUID_PATTERN.test(normalized)) throw httpError(400, `${fieldName} không hợp lệ.`)
  return normalized
}

function handleRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      console.error("[duty/offline]", error)
      res.status(error.status || 500).json({ error: error.message || "Không thể đồng bộ Phiếu trực." })
    }
  }
}

function uploadSingle(fieldName) {
  return (req, res, next) => {
    imageUpload.single(fieldName)(req, res, (error) => {
      if (!error) return next()
      res.status(error.status || (error instanceof multer.MulterError ? 400 : 500)).json({
        error: error.message || "Không thể đọc ảnh.",
      })
    })
  }
}

async function transaction(work) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await work(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

async function getOwnedSession(client, clientId, redClass) {
  const result = await client.query(
    `
      SELECT s.*
      FROM duty_session_client_ids identity
      JOIN duty_sessions s ON s.id = identity.session_id
      WHERE identity.client_id = $1 AND identity.red_class = $2 AND s.red_class = $2
      LIMIT 1
    `,
    [clientId, redClass],
  )
  const session = result.rows[0]
  if (!session) throw httpError(404, "Không tìm thấy Phiếu trực.")
  return session
}

async function ensureWeekOpen(client, weekId) {
  const result = await client.query(
    `SELECT 1 FROM week_closings WHERE week_id = $1 AND closed_at IS NOT NULL LIMIT 1`,
    [weekId],
  )
  if (result.rows[0]) throw httpError(403, "Tuần đã được khóa.")
}

async function findCompletedOperation(client, operationId, clientId, operationType) {
  const result = await client.query(
    `
      SELECT response_json
      FROM duty_offline_operations
      WHERE operation_id = $1 AND session_client_id = $2 AND operation_type = $3
      LIMIT 1
    `,
    [operationId, clientId, operationType],
  )
  return result.rows[0]?.response_json || null
}

async function completeOperation(client, operationId, clientId, operationType, response) {
  const result = await client.query(
    `
      INSERT INTO duty_offline_operations
        (operation_id, session_client_id, operation_type, response_json, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (operation_id) DO NOTHING
      RETURNING operation_id
    `,
    [operationId, clientId, operationType, JSON.stringify(response), time.now()],
  )
  if (!result.rows[0]) throw httpError(409, "operation_id đã được sử dụng cho thao tác khác.")
}

async function computeViolationHash(client, sessionId) {
  const result = await client.query(
    `
      SELECT rule_id, quantity, note
      FROM duty_violations
      WHERE session_id = $1
      ORDER BY rule_id ASC, note ASC, id ASC
    `,
    [sessionId],
  )
  const normalized = result.rows.map((row) => ({
    rule_id: Number(row.rule_id),
    quantity: Number(row.quantity || 0),
    note: String(row.note || ""),
  }))
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
}

async function markEdited(client, session, action) {
  if (session.signed_snapshot_hash) {
    const currentHash = await computeViolationHash(client, session.id)
    if (currentHash !== session.signed_snapshot_hash) {
      await client.query(`UPDATE duty_sessions SET status = 'draft', signed_at = NULL WHERE id = $1`, [session.id])
    }
  }
  await client.query(
    `INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES ($1, $2, $3)`,
    [session.id, action, time.now()],
  )
}

function offlineDataVersion(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
}

function snapshotValidUntil(week) {
  return week?.end_date ? `${week.end_date}T23:59:59+07:00` : null
}

async function buildOfflineSnapshot(ownerClass) {
  const today = time.today()
  const [weekResult, classesResult, rulesResult] = await Promise.all([
    pool.query(
      `
        SELECT id, week_number, start_date, end_date
        FROM schedule_weeks
        WHERE start_date <= $1 AND end_date >= $1
        ORDER BY week_number DESC
        LIMIT 1
      `,
      [today],
    ),
    pool.query(
      `
        SELECT
          c.id,
          c.name,
          c.grade,
          c.is_active,
          a.id AS account_id,
          a.pin_ban_can_su AS pin_hash,
          COALESCE(a.pin_version, 1) AS pin_version
        FROM classes c
        LEFT JOIN accounts a ON a.class_id = c.id
        WHERE c.is_active = 1
        ORDER BY c.grade ASC, c.name ASC
      `,
    ),
    pool.query(`SELECT id, category, name, score_delta FROM rules ORDER BY category ASC, id ASC`),
  ])

  const week = weekResult.rows[0] || null
  const assignmentsResult = week
    ? await pool.query(
      `SELECT red_class, duty_class FROM schedule_assignments WHERE week_id = $1 ORDER BY red_class ASC`,
      [week.id],
    )
    : { rows: [] }

  const classes = classesResult.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    grade: Number(row.grade || 0),
    is_active: Number(row.is_active || 0),
  }))
  const committees = classesResult.rows.map((row) => ({
    account_id: Number(row.account_id || 0),
    class_id: Number(row.id),
    class_name: row.name,
    pin_hash: String(row.pin_hash || ""),
    pin_version: Number(row.pin_version || 1),
  }))

  const versionedData = {
    version: 1,
    owner_class: ownerClass,
    week,
    assignments: assignmentsResult.rows,
    classes,
    committees,
    rules: rulesResult.rows.map((row) => ({
      id: Number(row.id),
      category: row.category,
      name: row.name,
      score_delta: Number(row.score_delta || 0),
    })),
  }

  return {
    ...versionedData,
    data_version: offlineDataVersion(versionedData),
    generated_at: time.now(),
    valid_until: snapshotValidUntil(week),
  }
}

router.get("/manifest", handleRoute(async (req, res) => {
  const ownerClass = String(req.session.user.class_name || "").trim()
  const snapshot = await buildOfflineSnapshot(ownerClass)
  res.set("Cache-Control", "no-store")
  res.json({
    version: snapshot.version,
    data_version: snapshot.data_version,
    generated_at: snapshot.generated_at,
    valid_until: snapshot.valid_until,
    owner_class: snapshot.owner_class,
    week_id: snapshot.week?.id || null,
  })
}))

router.get("/bootstrap", handleRoute(async (req, res) => {
  const ownerClass = String(req.session.user.class_name || "").trim()
  const snapshot = await buildOfflineSnapshot(ownerClass)
  res.set("Cache-Control", "no-store")
  res.json(snapshot)
}))

router.post("/operations/status", handleRoute(async (req, res) => {
  const operationIds = Array.isArray(req.body.operation_ids)
    ? [...new Set(req.body.operation_ids.map((value) => assertUuid(value, "operation_id")))].slice(0, 100)
    : []
  const knownSessionClientIds = Array.isArray(req.body.known_session_client_ids)
    ? [...new Set(req.body.known_session_client_ids.map((value) => assertUuid(value, "client_id")))].slice(0, 100)
    : []

  const [operationResult, sessionResult] = await Promise.all([
    operationIds.length
      ? pool.query(
        `
          SELECT operation.operation_id, operation.operation_type, operation.response_json
          FROM duty_offline_operations operation
          JOIN duty_session_client_ids identity
            ON identity.client_id = operation.session_client_id
          WHERE operation.operation_id = ANY($1::uuid[])
            AND identity.red_class = $2
          ORDER BY operation.created_at ASC
        `,
        [operationIds, req.session.user.class_name],
      )
      : { rows: [] },
    knownSessionClientIds.length
      ? pool.query(
        `
          SELECT client_id
          FROM duty_session_client_ids
          WHERE client_id = ANY($1::uuid[])
            AND red_class = $2
        `,
        [knownSessionClientIds, req.session.user.class_name],
      )
      : { rows: [] },
  ])
  const existingSessionClientIds = new Set(sessionResult.rows.map((row) => row.client_id))

  res.json({
    completed: operationResult.rows.map((row) => ({
      operation_id: row.operation_id,
      operation_type: row.operation_type,
      response: row.response_json,
    })),
    deleted_session_client_ids: knownSessionClientIds.filter((clientId) => !existingSessionClientIds.has(clientId)),
  })
}))

router.post("/sessions", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.body.client_id, "client_id")
  const redClass = req.session.user.class_name
  const date = String(req.body.date || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, "Ngày trực không hợp lệ.")

  const result = await transaction(async (client) => {
    const aliasResult = await client.query(
      `
        SELECT s.id, s.status, s.date, s.week_id, s.red_class, s.duty_class
        FROM duty_session_client_ids identity
        JOIN duty_sessions s ON s.id = identity.session_id
        WHERE identity.client_id = $1 AND identity.red_class = $2
        LIMIT 1
      `,
      [clientId, redClass],
    )
    if (aliasResult.rows[0]) return { ...aliasResult.rows[0], existing: true }

    const weekResult = await client.query(
      `
        SELECT * FROM schedule_weeks
        WHERE start_date <= $1 AND end_date >= $1
        ORDER BY week_number DESC LIMIT 1
      `,
      [date],
    )
    const week = weekResult.rows[0]
    if (!week) throw httpError(400, "Không có tuần học cho ngày trực.")
    await ensureWeekOpen(client, week.id)

    const assignmentResult = await client.query(
      `SELECT duty_class FROM schedule_assignments WHERE week_id = $1 AND red_class = $2 LIMIT 1`,
      [week.id, redClass],
    )
    const dutyClass = assignmentResult.rows[0]?.duty_class
    if (!dutyClass) throw httpError(400, "Không có phân công trực.")

    let sessionResult = await client.query(
      `
        INSERT INTO duty_sessions
          (client_id, week_id, date, red_class, duty_class, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'draft', $6)
        ON CONFLICT (week_id, date, red_class) DO NOTHING
        RETURNING id, status, date, week_id, red_class, duty_class
      `,
      [clientId, week.id, date, redClass, dutyClass, req.body.created_at || time.now()],
    )
    let session = sessionResult.rows[0]
    const created = Boolean(session)
    if (!session) {
      sessionResult = await client.query(
        `SELECT id, status, date, week_id, red_class, duty_class FROM duty_sessions WHERE week_id = $1 AND date = $2 AND red_class = $3 LIMIT 1`,
        [week.id, date, redClass],
      )
      session = sessionResult.rows[0]
      await client.query(`UPDATE duty_sessions SET client_id = COALESCE(client_id, $1) WHERE id = $2`, [clientId, session.id])
    }

    await client.query(
      `
        INSERT INTO duty_session_client_ids (client_id, session_id, red_class, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (client_id) DO NOTHING
      `,
      [clientId, session.id, redClass, time.now()],
    )
    return { ...session, existing: !created }
  })

  res.json({ success: true, session_id: result.id, session: result })
}))

router.post("/sessions/claim", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.body.client_id, "client_id")
  const sessionId = Number(req.body.session_id || 0)
  const redClass = req.session.user.class_name
  if (!sessionId) throw httpError(400, "Thiếu Phiếu trực.")

  const result = await transaction(async (client) => {
    const sessionResult = await client.query(
      `SELECT id, client_id FROM duty_sessions WHERE id = $1 AND red_class = $2 LIMIT 1`,
      [sessionId, redClass],
    )
    const session = sessionResult.rows[0]
    if (!session) throw httpError(404, "Không tìm thấy Phiếu trực.")
    await client.query(`UPDATE duty_sessions SET client_id = COALESCE(client_id, $1) WHERE id = $2`, [clientId, sessionId])
    await client.query(
      `
        INSERT INTO duty_session_client_ids (client_id, session_id, red_class, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (client_id) DO NOTHING
      `,
      [clientId, sessionId, redClass, time.now()],
    )
    return { client_id: clientId, session_id: sessionId }
  })
  res.json({ success: true, ...result })
}))

router.post("/sessions/:clientId/violations", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.params.clientId, "client_id")
  const operationId = assertUuid(req.body.operation_id, "operation_id")
  const violationClientId = assertUuid(req.body.violation_client_id, "violation_client_id")
  const ruleId = Number(req.body.rule_id || 0)
  const quantity = Number(req.body.quantity || 1)
  const note = String(req.body.note || "").trim()
  if (!ruleId || !Number.isFinite(quantity) || quantity < 1 || !note) throw httpError(400, "Dữ liệu vi phạm không hợp lệ.")

  const response = await transaction(async (client) => {
    const completed = await findCompletedOperation(client, operationId, clientId, "add_violation")
    if (completed) return completed
    const session = await getOwnedSession(client, clientId, req.session.user.class_name)
    await ensureWeekOpen(client, session.week_id)

    const ruleResult = await client.query(`SELECT id FROM rules WHERE id = $1 LIMIT 1`, [ruleId])
    if (!ruleResult.rows[0]) throw httpError(400, "Lỗi vi phạm không còn tồn tại.")
    const violationResult = await client.query(
      `
        INSERT INTO duty_violations (client_id, session_id, rule_id, quantity, note)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
        RETURNING id
      `,
      [violationClientId, session.id, ruleId, quantity, note],
    )
    const result = { success: true, id: violationResult.rows[0].id, violation_client_id: violationClientId }
    await markEdited(client, session, "offline:add_violation")
    await completeOperation(client, operationId, clientId, "add_violation", result)
    return result
  })
  res.json(response)
}))

router.post("/sessions/:clientId/violations/delete", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.params.clientId, "client_id")
  const operationId = assertUuid(req.body.operation_id, "operation_id")
  const violationId = Number(req.body.violation_id || 0)
  const violationClientId = req.body.violation_client_id
    ? assertUuid(req.body.violation_client_id, "violation_client_id")
    : null
  if (!violationId && !violationClientId) throw httpError(400, "Vi phạm không hợp lệ.")

  const response = await transaction(async (client) => {
    const completed = await findCompletedOperation(client, operationId, clientId, "delete_violation")
    if (completed) return completed
    const session = await getOwnedSession(client, clientId, req.session.user.class_name)
    await ensureWeekOpen(client, session.week_id)
    const deleted = await client.query(
      `
        DELETE FROM duty_violations
        WHERE session_id = $1
          AND (($2::integer > 0 AND id = $2) OR ($3::uuid IS NOT NULL AND client_id = $3))
        RETURNING id
      `,
      [session.id, violationId, violationClientId],
    )
    const deletedId = Number(deleted.rows[0]?.id || violationId || 0)
    const result = { success: true, id: deletedId }
    await markEdited(client, session, "offline:remove_violation")
    await completeOperation(client, operationId, clientId, "delete_violation", result)
    return result
  })
  res.json(response)
}))

router.post("/sessions/:clientId/violations/update", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.params.clientId, "client_id")
  const operationId = assertUuid(req.body.operation_id, "operation_id")
  const violationId = Number(req.body.violation_id || 0)
  const violationClientId = req.body.violation_client_id
    ? assertUuid(req.body.violation_client_id, "violation_client_id")
    : null
  const ruleId = Number(req.body.rule_id || 0)
  const quantity = Number(req.body.quantity || 0)
  const note = String(req.body.note || "").trim()
  if ((!violationId && !violationClientId) || !ruleId || !Number.isInteger(quantity) || quantity < 1 || !note) {
    throw httpError(400, "Dữ liệu vi phạm không hợp lệ.")
  }

  const response = await transaction(async (client) => {
    const completed = await findCompletedOperation(client, operationId, clientId, "update_violation")
    if (completed) return completed
    const session = await getOwnedSession(client, clientId, req.session.user.class_name)
    await ensureWeekOpen(client, session.week_id)
    const ruleResult = await client.query(`SELECT id FROM rules WHERE id = $1 LIMIT 1`, [ruleId])
    if (!ruleResult.rows[0]) throw httpError(400, "Lỗi vi phạm không còn tồn tại.")
    const updated = await client.query(
      `
        UPDATE duty_violations
        SET rule_id = $1, quantity = $2, note = $3
        WHERE session_id = $4
          AND (($5::integer > 0 AND id = $5) OR ($6::uuid IS NOT NULL AND client_id = $6))
        RETURNING id
      `,
      [ruleId, quantity, note, session.id, violationId, violationClientId],
    )
    if (!updated.rows[0]) throw httpError(404, "Không tìm thấy vi phạm cần sửa.")
    const result = { success: true, id: Number(updated.rows[0].id) }
    await markEdited(client, session, "offline:update_violation")
    await completeOperation(client, operationId, clientId, "update_violation", result)
    return result
  })
  res.json(response)
}))

router.post(
  "/sessions/:clientId/evidences",
  uploadSingle("file"),
  handleRoute(async (req, res) => {
    const clientId = assertUuid(req.params.clientId, "client_id")
    const operationId = assertUuid(req.body.operation_id, "operation_id")
    if (!req.file) throw httpError(400, "Thiếu ảnh minh chứng.")

    const existing = await pool.query(
      `SELECT response_json FROM duty_offline_operations WHERE operation_id = $1 AND session_client_id = $2 AND operation_type = 'upload_evidence' LIMIT 1`,
      [operationId, clientId],
    )
    if (existing.rows[0]) return res.json(existing.rows[0].response_json)

    let written
    try {
      written = await writeDutyImage(DUTY_EVIDENCE_DIRECTORY, "duty", req.file)
      const response = await transaction(async (client) => {
        const completed = await findCompletedOperation(client, operationId, clientId, "upload_evidence")
        if (completed) return completed
        const session = await getOwnedSession(client, clientId, req.session.user.class_name)
        await ensureWeekOpen(client, session.week_id)
        const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM duty_evidence_images WHERE session_id = $1`, [session.id])
        if (Number(countResult.rows[0].count) >= DUTY_EVIDENCE_LIMIT) throw httpError(400, "Phiếu trực đã đủ 10 ảnh minh chứng.")
        const imageResult = await client.query(
          `
            INSERT INTO duty_evidence_images
              (session_id, file_path, file_name, mime_type, byte_size, sort_order, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
          `,
          [session.id, written.fileName, sanitizeDutyEvidenceFileName(req.file.originalname), req.file.mimetype, req.file.size, Number(countResult.rows[0].count), time.now()],
        )
        const result = { success: true, id: imageResult.rows[0].id, url: `/api/duty/evidence/${imageResult.rows[0].id}/file` }
        await markEdited(client, session, "offline:add_evidence")
        await completeOperation(client, operationId, clientId, "upload_evidence", result)
        return result
      })
      res.json(response)
    } catch (error) {
      if (written?.diskPath) await fs.promises.rm(written.diskPath, { force: true })
      throw error
    }
  }),
)

router.post("/sessions/:clientId/evidences/delete", handleRoute(async (req, res) => {
  const clientId = assertUuid(req.params.clientId, "client_id")
  const operationId = assertUuid(req.body.operation_id, "operation_id")
  const imageId = Number(req.body.image_id || 0)
  if (!imageId) throw httpError(400, "Ảnh minh chứng không hợp lệ.")
  let filePath = null

  const response = await transaction(async (client) => {
    const completed = await findCompletedOperation(client, operationId, clientId, "delete_evidence")
    if (completed) return completed
    const session = await getOwnedSession(client, clientId, req.session.user.class_name)
    await ensureWeekOpen(client, session.week_id)
    const imageResult = await client.query(`SELECT id, file_path FROM duty_evidence_images WHERE id = $1 AND session_id = $2 LIMIT 1`, [imageId, session.id])
    filePath = imageResult.rows[0]?.file_path || null
    await client.query(`DELETE FROM duty_evidence_images WHERE id = $1 AND session_id = $2`, [imageId, session.id])
    const result = { success: true, id: imageId }
    await markEdited(client, session, "offline:remove_evidence")
    await completeOperation(client, operationId, clientId, "delete_evidence", result)
    return result
  })
  if (filePath) await fs.promises.rm(require("path").join(DUTY_EVIDENCE_DIRECTORY, require("path").basename(filePath)), { force: true })
  res.json(response)
}))

router.post(
  "/sessions/:clientId/sign",
  uploadSingle("photo"),
  handleRoute(async (req, res) => {
    const clientId = assertUuid(req.params.clientId, "client_id")
    const operationId = assertUuid(req.body.operation_id, "operation_id")
    const redClass = req.session.user.class_name

    const existing = await pool.query(
      `SELECT response_json FROM duty_offline_operations WHERE operation_id = $1 AND session_client_id = $2 AND operation_type = 'sign' LIMIT 1`,
      [operationId, clientId],
    )
    if (existing.rows[0]) return res.json(existing.rows[0].response_json)

    let written = null
    try {
      if (req.file) written = await writeDutyImage(DUTY_SIGNATURE_DIRECTORY, "duty", req.file)
      const response = await transaction(async (client) => {
        const completed = await findCompletedOperation(client, operationId, clientId, "sign")
        if (completed) return completed
        const session = await getOwnedSession(client, clientId, redClass)
        await ensureWeekOpen(client, session.week_id)
        const signedAt = time.now()
        const photoPath = written ? `/assets/duty-signatures/${written.fileName}` : null
        const signatureResult = await client.query(
          `INSERT INTO duty_signatures (session_id, photo_path, signed_at) VALUES ($1, $2, $3) RETURNING id`,
          [session.id, photoPath, signedAt],
        )
        const hash = await computeViolationHash(client, session.id)
        await client.query(
          `UPDATE duty_sessions SET status = 'signed', signed_at = $1, signed_snapshot_hash = $2 WHERE id = $3`,
          [signedAt, hash, session.id],
        )
        await client.query(`INSERT INTO duty_revision_logs (session_id, action, created_at) VALUES ($1, 'offline:sign', $2)`, [session.id, signedAt])
        const result = { success: true, signature_id: signatureResult.rows[0].id, photo_path: photoPath, signed_at: signedAt }
        await completeOperation(client, operationId, clientId, "sign", result)
        return result
      })
      res.json(response)
    } catch (error) {
      if (written?.diskPath) await fs.promises.rm(written.diskPath, { force: true })
      throw error
    }
  }),
)

module.exports = router
