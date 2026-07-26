const crypto = require("crypto")
const bcrypt = require("bcrypt")
const fs = require("fs")
const path = require("path")
const { loadEnv } = require("../config/env")

loadEnv()

const { pool } = require("../config/database")

const BASE_URL = process.env.QA_BASE_URL || "http://127.0.0.1:3000"
const PASSWORD = process.env.CLASS_DEFAULT_PASSWORD || "Nt@12345"
const PIN = process.env.CLASS_DEFAULT_PIN || "032026"

let cookie = ""
let redClass = ""
let dutyClass = ""
let signatureDiskPath = ""
const clientIds = []
const classIds = []

async function request(method, path, body, rawBody = false) {
  const headers = cookie ? { Cookie: cookie } : {}
  if (!rawBody) headers["Content-Type"] = "application/json"
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : rawBody ? body : JSON.stringify(body),
  })
  const setCookie = response.headers.get("set-cookie")
  if (setCookie) cookie = setCookie.split(";")[0]
  const contentType = response.headers.get("content-type") || ""
  const data = contentType.includes("application/json") ? await response.json() : await response.text()
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`)
  }
  return data
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

async function cleanup() {
  if (clientIds.length) {
    await pool.query(`DELETE FROM duty_offline_operations WHERE session_client_id = ANY($1::uuid[])`, [clientIds])
    await pool.query(`DELETE FROM duty_session_client_ids WHERE client_id = ANY($1::uuid[])`, [clientIds])
  }
  if (classIds.length) {
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::integer[])`, [classIds])
  }
  if (signatureDiskPath) {
    await fs.promises.rm(signatureDiskPath, { force: true })
  }
}

async function setupFixture() {
  const suffix = `${Date.now()}`.slice(-8)
  redClass = `QAR${suffix}`
  dutyClass = `QAD${suffix}`
  const weekResult = await pool.query(
    `SELECT id FROM schedule_weeks WHERE start_date <= $1 AND end_date >= $1 ORDER BY week_number DESC LIMIT 1`,
    [localDate()],
  )
  const weekId = weekResult.rows[0]?.id
  if (!weekId) throw new Error("No active schedule week for offline QA")

  const redResult = await pool.query(`INSERT INTO classes (name, grade, is_active) VALUES ($1, 12, 1) RETURNING id`, [redClass])
  classIds.push(redResult.rows[0].id)
  const dutyResult = await pool.query(`INSERT INTO classes (name, grade, is_active) VALUES ($1, 11, 1) RETURNING id`, [dutyClass])
  classIds.push(dutyResult.rows[0].id)

  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const pinHash = await bcrypt.hash(PIN, 12)
  for (const classId of classIds) {
    await pool.query(
      `
        INSERT INTO accounts
          (class_id, password_gvcn, password_ban_can_su, password_codo, pin_ban_can_su,
           pin_failed_attempts, pin_locked_until, pin_version, password_changed,
           password_changed_gvcn, password_changed_ban_can_su, password_changed_codo, created_at)
        VALUES ($1, $2, $2, $2, $3, 0, 0, 1, 1, 1, 1, 1, $4)
      `,
      [classId, passwordHash, pinHash, new Date().toISOString()],
    )
  }
  await pool.query(
    `INSERT INTO schedule_assignments (week_id, red_class, duty_class) VALUES ($1, $2, $3)`,
    [weekId, redClass, dutyClass],
  )
}

async function main() {
  await setupFixture()
  await request("POST", "/api/auth/login", {
    role: "co_do",
    class_name: redClass,
    password: PASSWORD,
  })

  const clientA = crypto.randomUUID()
  const clientB = crypto.randomUUID()
  clientIds.push(clientA, clientB)
  const createPayload = { client_id: clientA, date: localDate(), created_at: new Date().toISOString() }
  const first = await request("POST", "/api/duty/offline/sessions", createPayload)
  const duplicate = await request("POST", "/api/duty/offline/sessions", createPayload)
  const naturalConflict = await request("POST", "/api/duty/offline/sessions", {
    ...createPayload,
    client_id: clientB,
  })
  assert(first.session_id === duplicate.session_id, "Retry created a second duty session")
  assert(first.session_id === naturalConflict.session_id, "Two client IDs created duplicate daily sessions")

  const rules = await request("GET", "/api/rules")
  assert(Array.isArray(rules) && rules[0]?.id, "No rule available for the offline test")
  const violationOperation = crypto.randomUUID()
  const violationClientId = crypto.randomUUID()
  const violationPayload = {
    operation_id: violationOperation,
    violation_client_id: violationClientId,
    rule_id: rules[0].id,
    quantity: 1,
    note: "QA offline idempotency",
  }
  const violation = await request("POST", `/api/duty/offline/sessions/${clientA}/violations`, violationPayload)
  const violationRetry = await request("POST", `/api/duty/offline/sessions/${clientA}/violations`, violationPayload)
  assert(violation.id === violationRetry.id, "Violation retry was not idempotent")
  await request("POST", `/api/duty/offline/sessions/${clientA}/violations/delete`, {
    operation_id: crypto.randomUUID(),
    violation_id: violation.id,
    violation_client_id: violationClientId,
  })

  const evidenceOperation = crypto.randomUUID()
  const imageBytes = Buffer.from("89504e470d0a1a0a", "hex")
  const upload = async () => {
    const form = new FormData()
    form.append("operation_id", evidenceOperation)
    form.append("file", new Blob([imageBytes], { type: "image/png" }), "qa-offline.png")
    return request("POST", `/api/duty/offline/sessions/${clientA}/evidences`, form, true)
  }
  const evidence = await upload()
  const evidenceRetry = await upload()
  assert(evidence.id === evidenceRetry.id, "Evidence retry was not idempotent")
  await request("POST", `/api/duty/offline/sessions/${clientA}/evidences/delete`, {
    operation_id: crypto.randomUUID(),
    image_id: evidence.id,
  })

  const manifest = await request("GET", "/api/duty/offline/manifest")
  const bootstrap = await request("GET", "/api/duty/offline/bootstrap")
  assert(manifest.data_version === bootstrap.data_version, "Manifest and bootstrap versions differ")
  assert(manifest.week_id === bootstrap.week.id, "Manifest and bootstrap weeks differ")
  assert(Date.parse(bootstrap.valid_until) > Date.now(), "Offline snapshot is already expired")
  const dutyCommittee = bootstrap.committees.find((item) => item.class_name === dutyClass)
  assert(dutyCommittee?.pin_hash, "Offline PIN hash was not included in bootstrap")
  assert(dutyCommittee.pin_version === 1, "Offline PIN version does not match the account")
  assert(await bcrypt.compare(PIN, dutyCommittee.pin_hash), "Offline PIN hash does not match the class PIN")
  await pool.query(`UPDATE accounts SET pin_version = pin_version + 1 WHERE class_id = $1`, [classIds[1]])
  const changedManifest = await request("GET", "/api/duty/offline/manifest")
  assert(changedManifest.data_version !== manifest.data_version, "Manifest did not change after the PIN version changed")

  const signOperation = crypto.randomUUID()
  const sign = async () => {
    const form = new FormData()
    form.append("operation_id", signOperation)
    form.append("photo", new Blob([imageBytes], { type: "image/png" }), "qa-signature.png")
    return request("POST", `/api/duty/offline/sessions/${clientA}/sign`, form, true)
  }
  const signature = await sign()
  if (signature.photo_path) {
    signatureDiskPath = path.join(__dirname, "..", String(signature.photo_path).replace(/^\/assets\//, "assets/"))
  }
  const signatureRetry = await sign()
  assert(signature.signature_id === signatureRetry.signature_id, "Signature retry was not idempotent")
  const signatureCount = await pool.query(`SELECT COUNT(*)::int AS count FROM duty_signatures WHERE session_id = $1`, [first.session_id])
  assert(signatureCount.rows[0].count === 1, "Signature retry inserted more than one row")
  const missingSessionClientId = crypto.randomUUID()
  const operationStatus = await request("POST", "/api/duty/offline/operations/status", {
    operation_ids: [violationOperation, evidenceOperation, signOperation, crypto.randomUUID()],
    known_session_client_ids: [clientA, missingSessionClientId],
  })
  const completedOperationIds = new Set(operationStatus.completed.map((item) => item.operation_id))
  assert(completedOperationIds.has(violationOperation), "Completed violation operation was not reconciled")
  assert(completedOperationIds.has(evidenceOperation), "Completed evidence operation was not reconciled")
  assert(completedOperationIds.has(signOperation), "Completed signature operation was not reconciled")
  assert(completedOperationIds.size === 3, "Unknown operation was incorrectly marked as completed")
  assert(!operationStatus.deleted_session_client_ids.includes(clientA), "Existing session was incorrectly marked as deleted")
  assert(operationStatus.deleted_session_client_ids.includes(missingSessionClientId), "Deleted session was not reconciled")

  console.log(JSON.stringify({
    sessionId: first.session_id,
    aliasesConverged: true,
    violationRetryStable: true,
    evidenceRetryStable: true,
    offlineBootstrapReady: true,
    offlineManifestVersioned: true,
    completedOperationsReconciled: true,
    deletedSessionsReconciled: true,
    signatureRetryStable: true,
  }, null, 2))
}

main()
  .finally(async () => {
    await cleanup()
    await pool.end()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
