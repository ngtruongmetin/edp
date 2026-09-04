const bcrypt = require("bcrypt")
const { loadEnv } = require("../config/env")

loadEnv()

const { pool } = require("../config/database")

const BASE_URL = process.env.QA_BASE_URL || "http://127.0.0.1:3000"
const PASSWORD = process.env.CLASS_DEFAULT_PASSWORD || "Nt@12345"
const PIN = process.env.CLASS_DEFAULT_PIN || "032026"
const ADMIN_USERNAME = process.env.QA_ADMIN_USERNAME || process.env.SEED_ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || "admin123"

let cookie = ""
let originalOfflineSetting = null
const classIds = []

async function request(method, path, body) {
  const headers = cookie ? { Cookie: cookie } : {}
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json"
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  const setCookie = response.headers.get("set-cookie")
  if (setCookie) cookie = setCookie.split(";")[0]
  const contentType = response.headers.get("content-type") || ""
  const data = contentType.includes("application/json") ? await response.json() : await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`)
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

async function setupFixture() {
  const suffix = `${Date.now()}`.slice(-8)
  const redClass = `QAR${suffix}`
  const dutyClass = `QAD${suffix}`
  const weekResult = await pool.query(
    `SELECT id FROM schedule_weeks WHERE start_date <= $1 AND end_date >= $1 ORDER BY week_number DESC LIMIT 1`,
    [localDate()],
  )
  const weekId = weekResult.rows[0]?.id
  if (!weekId) throw new Error("No active schedule week for online QA")

  const redResult = await pool.query(`INSERT INTO classes (name, grade, is_active) VALUES ($1, 12, 1) RETURNING id`, [redClass])
  const dutyResult = await pool.query(`INSERT INTO classes (name, grade, is_active) VALUES ($1, 11, 1) RETURNING id`, [dutyClass])
  classIds.push(redResult.rows[0].id, dutyResult.rows[0].id)
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const pinHash = await bcrypt.hash(PIN, 12)
  for (const classId of classIds) {
    await pool.query(
      `INSERT INTO accounts (class_id, password_gvcn, password_ban_can_su, password_codo, pin_ban_can_su, pin_failed_attempts, pin_locked_until, pin_version, password_changed, password_changed_gvcn, password_changed_ban_can_su, password_changed_codo, created_at) VALUES ($1, $2, $2, $2, $3, 0, 0, 1, 1, 1, 1, 1, $4)`,
      [classId, passwordHash, pinHash, new Date().toISOString()],
    )
  }
  await pool.query(`INSERT INTO schedule_assignments (week_id, red_class, duty_class) VALUES ($1, $2, $3)`, [weekId, redClass, dutyClass])
  return { redClass, dutyClass }
}

async function cleanup() {
  if (originalOfflineSetting) {
    try {
      cookie = ""
      await request("POST", "/api/auth/admin/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
      await request("PUT", "/api/system-settings", { settings: { offline_duty_enabled: originalOfflineSetting.setting_value } })
    } catch (error) {
      console.warn("Could not restore offline setting through admin API:", error.message)
    }
  }
  if (classIds.length) await pool.query(`DELETE FROM classes WHERE id = ANY($1::integer[])`, [classIds])
}

async function main() {
  originalOfflineSetting = (await pool.query(`SELECT setting_value, description, updated_at, updated_by FROM system_settings WHERE setting_key='offline_duty_enabled' LIMIT 1`)).rows[0] || null
  const fixture = await setupFixture()

  await request("POST", "/api/auth/admin/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
  await request("PUT", "/api/system-settings", { settings: { offline_duty_enabled: "0" } })
  cookie = ""

  await request("POST", "/api/auth/login", { role: "co_do", class_name: fixture.redClass, password: PASSWORD })
  const setting = await request("GET", "/api/system-settings/offline-duty")
  assert(setting.enabled === false, "Offline setting was not disabled")

  const rules = await request("GET", "/api/rules")
  const firstRule = rules[0]
  assert(firstRule?.id && firstRule.name, "No rule available")
  const secondRule = rules.find((rule) => rule.id !== firstRule.id) || firstRule

  const created = await request("POST", "/api/duty/create")
  assert(created.session_id, "Online duty session was not created")
  const sessionId = created.session_id
  const initial = await request("GET", `/api/duty/my/session/${sessionId}`)
  assert(initial.session?.id === sessionId, "Online session detail failed")

  const added = await request("POST", "/api/duty/violation", { session_id: sessionId, rule_id: firstRule.id, quantity: 2, note: "QA online add" })
  assert(added.id, "Online violation add failed")
  const updated = await request("PUT", `/api/duty/violation/${added.id}`, { rule_id: secondRule.id, quantity: 3, note: "QA online update" })
  assert(updated.success, "Online violation update failed")
  const afterUpdate = await request("GET", `/api/duty/my/session/${sessionId}`)
  const currentViolation = afterUpdate.violations.find((item) => Number(item.id) === Number(added.id))
  assert(currentViolation?.quantity === 3 && currentViolation?.note === "QA online update", "Online violation update was not persisted")

  const deleted = await request("DELETE", `/api/duty/violation/${added.id}`)
  assert(deleted.success, "Online violation delete failed")
  const afterDelete = await request("GET", `/api/duty/my/session/${sessionId}`)
  assert(!afterDelete.violations.some((item) => Number(item.id) === Number(added.id)), "Online violation delete was not persisted")

  const retained = await request("POST", "/api/duty/violation", { session_id: sessionId, rule_id: firstRule.id, quantity: 1, note: "QA online sign" })
  assert(retained.id, "Online violation for sign failed")
  const form = new FormData()
  form.append("session_id", String(sessionId))
  form.append("pin", PIN)
  const signed = await request("POST", "/api/duty/sign", form)
  assert(signed.success, "Online sign failed")

  const detail = await request("GET", `/api/duty/my/session/${sessionId}`)
  assert(detail.session.status === "signed", "Session was not signed")
  const revisions = (await pool.query(`SELECT action, actor_role, metadata FROM duty_revision_logs WHERE session_id=$1 ORDER BY id ASC`, [sessionId])).rows
  const actions = new Set(revisions.map((revision) => revision.action))
  assert(actions.has("edit:add_violation") && actions.has("edit:update_violation") && actions.has("edit:remove_violation") && actions.has("sign"), "Expected online revision actions are missing")
  const addRevision = revisions.find((revision) => revision.action === "edit:add_violation" && revision.metadata?.rule_name)
  const updateRevision = revisions.find((revision) => revision.action === "edit:update_violation" && revision.metadata?.old_quantity !== undefined)
  const signRevision = revisions.find((revision) => revision.action === "sign" && revision.metadata?.total_points !== undefined)
  assert(addRevision && updateRevision && signRevision, "Structured online revision metadata is incomplete")

  console.log(JSON.stringify({ onlineSettingDisabled: true, onlineCreate: true, onlineCrud: true, onlineSign: true, structuredHistory: true }, null, 2))
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
