const { spawn } = require("child_process")
const path = require("path")

const PORT = Number(process.env.QA_PORT || 3010)
const BASE = process.env.QA_BASE_URL || `http://127.0.0.1:${PORT}`
const ADMIN = { username: "admin", password: "admin123" }
const DEFAULT_CLASS_PASSWORD = process.env.CLASS_DEFAULT_PASSWORD || "Nt@12345"
const DEFAULT_PIN = process.env.CLASS_DEFAULT_PIN || "032026"

const results = []
let cookie = ""
let server = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/`)
      if (res.ok) return
    } catch {
      // keep waiting
    }
    await sleep(500)
  }
  throw new Error(`Server did not start at ${BASE}`)
}

async function startServer() {
  if (process.env.QA_BASE_URL) return

  server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  server.stdout.on("data", (chunk) => {
    const text = String(chunk)
    if (/Failed|Error|error/i.test(text)) process.stdout.write(`[server] ${text}`)
  })
  server.stderr.on("data", (chunk) => process.stderr.write(`[server:err] ${String(chunk)}`))

  await waitForServer()
}

function stopServer() {
  if (server && !server.killed) {
    server.kill()
  }
}

async function request(method, url, body, opts = {}) {
  const headers = {
    ...(opts.rawBody ? {} : { "Content-Type": "application/json" }),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(opts.headers || {}),
  }
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: opts.rawBody ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get("set-cookie")
  if (setCookie) cookie = setCookie.split(";")[0]

  const contentType = res.headers.get("content-type") || ""
  const buffer = Buffer.from(await res.arrayBuffer())
  let data = buffer
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(buffer.toString("utf8") || "{}")
    } catch {
      data = { parse_error: buffer.toString("utf8") }
    }
  } else if (contentType.includes("text/")) {
    data = buffer.toString("utf8")
  }
  return { status: res.status, headers: res.headers, data, size: buffer.length }
}

function pass(name, detail = "") {
  results.push({ ok: true, name, detail })
}

function fail(name, detail = "") {
  results.push({ ok: false, name, detail })
}

async function expect(method, url, body, allowed, name = `${method} ${url}`) {
  const res = await request(method, url, body)
  const statuses = Array.isArray(allowed) ? allowed : [allowed]
  const detail = `${res.status} ${typeof res.data === "object" && !Buffer.isBuffer(res.data) ? JSON.stringify(res.data).slice(0, 240) : String(res.data).slice(0, 240)}`
  if (statuses.includes(res.status)) pass(name, detail)
  else fail(name, detail)
  return res
}

async function expectBlob(method, url, body, allowed, name = `${method} ${url}`) {
  const res = await request(method, url, body)
  const statuses = Array.isArray(allowed) ? allowed : [allowed]
  const detail = `${res.status} ${res.size} bytes ${res.headers.get("content-type") || ""}`
  if (statuses.includes(res.status) && res.size > 0) pass(name, detail)
  else fail(name, detail)
  return res
}

async function adminLogin() {
  cookie = ""
  const res = await expect("POST", "/api/auth/admin/login", ADMIN, 200, "Authentication: admin login")
  if (res.status !== 200) throw new Error("Cannot login as admin")
}

async function classLogin(role, className, password = DEFAULT_CLASS_PASSWORD) {
  cookie = ""
  return expect("POST", "/api/auth/login", { role, class_name: className, password }, 200, `Authentication: ${role} login`)
}

async function testAuthAndSettings() {
  cookie = ""
  await expect("GET", "/api/auth/me", undefined, 401, "Authentication: me requires login")
  await expect("POST", "/api/auth/admin/login", { username: "admin", password: "wrong" }, 401, "Authentication: wrong admin password")
  await adminLogin()
  await expect("GET", "/api/auth/me", undefined, 200, "Authentication: me after login")
  await expect("GET", "/api/system-settings", undefined, 200, "System Settings: list")
  const settings = await request("GET", "/api/system-settings")
  const originalSettings = settings.data?.settings || {}
  const originalValues = Object.fromEntries(
    Object.entries(originalSettings).map(([key, item]) => [key, item?.value ?? ""]),
  )
  await expect(
    "PUT",
    "/api/system-settings",
    {
      settings: {
        base_score: String(originalValues.base_score || "100"),
        school_year: String(originalValues.school_year || "2026-2027"),
        use_electronic_gradebook: "0",
      },
    },
    200,
    "System Settings: update safe boolean",
  )
  await expect("GET", "/api/system-settings/ai", undefined, 200, "System Settings AI: read")
  await expect("GET", "/api/system-settings/ai/models", undefined, [200, 400, 500], "System Settings AI: models")
  await expect("POST", "/api/system-settings/ai/test-connection", {}, [400, 500], "System Settings AI: test validation/unavailable")
  await expect("PUT", "/api/system-settings/ai", { temperature: 0 }, [200, 400], "System Settings AI: safe update validation")
  await expect("POST", "/api/ai/codo/prompt-preview", { message: "Test QA" }, 200, "AI: admin prompt preview")
  await expect(
    "PUT",
    "/api/system-settings",
    {
      settings: {
        base_score: String(originalValues.base_score || "100"),
        school_year: String(originalValues.school_year || "2026-2027"),
        use_electronic_gradebook: String(originalValues.use_electronic_gradebook || "1"),
      },
    },
    200,
    "System Settings: restore",
  )
}

async function testClassesAndRules(ctx) {
  await adminLogin()
  await expect("GET", "/api/classes", undefined, 200, "Classes: public list")
  await expect("GET", "/api/classes/admin", undefined, 200, "Classes: admin list")

  const suffix = String(Date.now()).slice(-5)
  ctx.redClass = `12A${suffix}`
  ctx.dutyClass = `11A${suffix}`

  const red = await expect("POST", "/api/classes/create", { name: ctx.redClass }, [200, 409], "Classes: create red QA class")
  if (red.data?.class_id) ctx.redClassId = red.data.class_id
  const duty = await expect("POST", "/api/classes/create", { name: ctx.dutyClass }, [200, 409], "Classes: create duty QA class")
  if (duty.data?.class_id) ctx.dutyClassId = duty.data.class_id

  await expect("POST", "/api/classes/create", {}, 400, "Classes: create validation")
  if (ctx.redClassId) {
    await expect("PATCH", `/api/classes/${ctx.redClassId}/toggle`, undefined, 200, "Classes: toggle")
    await expect("PATCH", `/api/classes/${ctx.redClassId}/toggle`, undefined, 200, "Classes: toggle restore")
    await expect("POST", `/api/classes/${ctx.redClassId}/reset-pin`, undefined, 200, "Classes: reset pin")
  }
  if (ctx.redClassId) {
    await expect("POST", `/api/classes/${ctx.redClassId}/reset-password/gvcn`, undefined, 200, "Classes: reset gvcn password")
  }
  await expect("DELETE", "/api/classes/99999999", undefined, [200, 404], "Classes: delete missing")

  const ruleName = `QA rule ${suffix}`
  await expect("GET", "/api/rules", undefined, 200, "Rules: list")
  await expectBlob("GET", "/api/rules/template", undefined, 200, "Rules: template")
  await expectBlob("GET", "/api/rules/export", undefined, 200, "Rules: export")
  await expect("POST", "/api/rules/import", { fileData: "not-base64" }, 400, "Rules: import invalid file")
  const created = await expect(
    "POST",
    "/api/rules/create",
    { category: "QA", name: ruleName, score_delta: -1 },
    200,
    "Rules: create",
  )
  const rules = await request("GET", "/api/rules/admin")
  ctx.ruleId = (rules.data || []).find((r) => r.name === ruleName)?.id
  if (ctx.ruleId) {
    await expect("PATCH", `/api/rules/${ctx.ruleId}`, { category: "QA", name: `${ruleName} updated`, score_delta: -2 }, 200, "Rules: update")
  } else if (created.status === 200) {
    fail("Rules: locate created rule", "Created rule was not returned by admin list")
  }
  await expect("PATCH", "/api/rules/99999999", { category: "QA", name: "missing", score_delta: 0 }, 200, "Rules: update missing current behavior")
}

async function testScheduleTime(ctx) {
  await adminLogin()
  await expect("GET", "/api/schedule", undefined, 200, "Schedule: current")
  await expect("GET", "/api/schedule/all", undefined, 200, "Schedule: all")
  await expect("GET", "/api/schedule/admin", undefined, 200, "Schedule: admin weeks")
  await expect("GET", "/api/schedule/admin/time", undefined, 200, "Schedule Time: list")
  await expect("POST", "/api/schedule/admin/school-years", { name: "bad" }, 400, "School Year: validation")

  const semesterNumber = 8
  const sem = await expect("POST", "/api/schedule/admin/semesters", { semester_number: semesterNumber }, [200, 409], "Semester: create")
  if (sem.data?.id) ctx.semesterId = sem.data.id
  if (!ctx.semesterId) {
    const timeState = await request("GET", "/api/schedule/admin/time")
    ctx.semesterId = (timeState.data.semesters || []).find((s) => Number(s.semester_number) === semesterNumber)?.id
  }
  await expect("POST", "/api/schedule/admin/semesters", { semester_number: 99 }, 400, "Semester: create validation")
  if (ctx.semesterId) {
    await expect("PUT", `/api/schedule/admin/semesters/${ctx.semesterId}`, { semester_number: 7 }, [200, 409], "Semester: update")
    await expect("PUT", `/api/schedule/admin/semesters/${ctx.semesterId}`, { semester_number: semesterNumber }, [200, 409], "Semester: update restore")
  }

  const monthKey = "08/2027"
  const month = await expect("POST", "/api/schedule/admin/months", { semester_id: ctx.semesterId, month_key: monthKey }, [200, 409], "Month: create")
  if (month.data?.id) ctx.monthId = month.data.id
  if (!ctx.monthId) {
    const timeState = await request("GET", "/api/schedule/admin/time")
    ctx.monthId = (timeState.data.months || []).find((m) => m.month_key === monthKey)?.id
  }
  ctx.monthKey = monthKey
  await expect("POST", "/api/schedule/admin/months", { semester_id: ctx.semesterId, month_key: "8/2027" }, 400, "Month: validation")
  if (ctx.monthId) {
    await expect("PUT", `/api/schedule/admin/months/${ctx.monthId}`, { month_key: "07/2027" }, [200, 409], "Month: update")
    await expect("PUT", `/api/schedule/admin/months/${ctx.monthId}`, { month_key: monthKey }, [200, 409], "Month: update restore")
  }

  const week = await expect(
    "POST",
    "/api/schedule/create-week",
    { month_id: ctx.monthId, week_number: 998, start_date: "02/08/2027", end_date: "08/08/2027" },
    200,
    "Week: create",
  )
  ctx.weekId = week.data?.week_id
  await expect("POST", "/api/schedule/create-week", { month_id: ctx.monthId, week_number: 999, start_date: "bad", end_date: "2027-08-08" }, 400, "Week: create validation")
  if (ctx.weekId) {
    await expect("GET", `/api/schedule/week/${ctx.weekId}`, undefined, 200, "Week: read detail")
    await expect("POST", "/api/schedule/update-week", { week_id: ctx.weekId, week_number: 997, start_date: "2027-08-03", end_date: "2027-08-09", month_id: ctx.monthId }, 200, "Week: update")
    await expect("POST", "/api/schedule/save", { week_id: ctx.weekId, assignments: [{ red_class: ctx.redClass, duty_class: ctx.dutyClass }] }, 200, "Schedule assignments: save")
  }
}

async function testDutyAndSummaries(ctx) {
  await adminLogin()
  await expect("GET", "/api/duty/public/landing-stats", undefined, 200, "Duty public: landing stats")
  await expect("GET", "/api/duty/public/landing-competition", undefined, 200, "Duty public: landing competition")
  await expect("GET", `/api/duty/admin/week/${ctx.weekId}`, undefined, 200, "Duty Admin Week: list sessions")
  await expect("GET", `/api/duty/admin/week/${ctx.weekId}/stats`, undefined, 200, "Duty Admin Week: stats")
  await expect("GET", `/api/duty/admin/week/${ctx.weekId}/summary`, undefined, 200, "Weekly Scores: summary preview")
  await expect("GET", `/api/duty/admin/week/${ctx.weekId}/class/${encodeURIComponent(ctx.dutyClass)}/breakdown`, undefined, 200, "Weekly Scores: class breakdown")
  await expectBlob("GET", `/api/duty/admin/week/${ctx.weekId}/export`, undefined, 200, "Weekly Scores: export")
  const currentSettings = await request("GET", "/api/system-settings")
  const electronicGradebook = currentSettings.data?.settings?.use_electronic_gradebook?.value || "1"
  await expect("PUT", "/api/system-settings", { settings: { use_electronic_gradebook: "0" } }, 200, "Weekly Close: disable electronic gradebook requirement")
  await expect("POST", `/api/duty/admin/week/${ctx.weekId}/close`, undefined, 200, "Weekly Close: close and write PostgreSQL scores")
  await expect("GET", `/api/duty/admin/week/${ctx.weekId}/summary`, undefined, 200, "Weekly Close: read persisted weekly scores")
  await expect("POST", `/api/duty/admin/week/${ctx.weekId}/reopen`, undefined, 200, "Weekly Close: reopen")
  await expect("PUT", "/api/system-settings", { settings: { use_electronic_gradebook: electronicGradebook } }, 200, "Weekly Close: restore electronic gradebook setting")
  await expect("GET", "/api/duty/admin/month/list", undefined, 200, "Month Summary: list")
  await expect("POST", "/api/duty/admin/month/preview", { month_key: ctx.monthKey }, 200, "Month Summary: preview")
  await expect("POST", "/api/duty/admin/month/adjustment", { month_key: ctx.monthKey, class_name: ctx.dutyClass, plus_points: 1, minus_points: 0, reason: "QA" }, 200, "Month Adjustment: create/update")
  await expect("DELETE", "/api/duty/admin/month/adjustment", { month_key: ctx.monthKey, class_name: ctx.dutyClass }, 200, "Month Adjustment: delete")
  await expect("POST", "/api/duty/admin/month/adjustment/upload", { month_key: ctx.monthKey, file_data: "bad" }, 400, "Month Adjustment: upload invalid")
  await expectBlob("GET", "/api/duty/admin/month/adjustment/template", undefined, 200, "Month Adjustment: template")
  await expect("GET", `/api/duty/admin/month/${encodeURIComponent(ctx.monthKey)}/summary`, undefined, 200, "Month Summary: read")
  await expect("GET", `/api/duty/admin/month/${encodeURIComponent(ctx.monthKey)}/class/${encodeURIComponent(ctx.dutyClass)}/breakdown`, undefined, [200, 404], "Month Summary: class breakdown")
  await expectBlob("GET", `/api/duty/admin/month/${encodeURIComponent(ctx.monthKey)}/export`, undefined, 200, "Month Summary: export")

  await expect("GET", "/api/duty/admin/semester/list", undefined, 200, "Semester Summary: list")
  const semesterKey = `2026-2027-HK8`
  ctx.semesterKey = semesterKey
  await expect("POST", "/api/duty/admin/semester/save", { semester_key: semesterKey }, [200, 400], "Semester Summary: save")
  await expect("POST", "/api/duty/admin/semester/preview", { semester_key: semesterKey }, [200, 400], "Semester Summary: preview")
  await expect("POST", "/api/duty/admin/semester/adjustment", { semester_key: semesterKey, class_name: ctx.dutyClass, plus_points: 1, minus_points: 0, reason: "QA" }, 200, "Semester Adjustment: create/update")
  await expect("DELETE", "/api/duty/admin/semester/adjustment", { semester_key: semesterKey, class_name: ctx.dutyClass }, 200, "Semester Adjustment: delete")
  await expect("GET", `/api/duty/admin/semester/${encodeURIComponent(semesterKey)}/class/${encodeURIComponent(ctx.dutyClass)}/breakdown`, undefined, [200, 400, 404], "Semester Summary: class breakdown")
  await expectBlob("GET", `/api/duty/admin/semester/${encodeURIComponent(semesterKey)}/export`, undefined, [200, 400], "Semester Summary: export")

  await expect("GET", "/api/duty/admin/year/list", undefined, 200, "Year Summary: list")
  await expect("POST", "/api/duty/admin/year/save", { year_key: "2026-2027" }, [200, 400], "Year Summary: save")
  await expect("POST", "/api/duty/admin/year/preview", { year_key: "2026-2027" }, [200, 400], "Year Summary: preview")
  await expect("POST", "/api/duty/admin/year/adjustment", { year_key: "2026-2027", class_name: ctx.dutyClass, plus_points: 1, minus_points: 0, reason: "QA" }, 200, "Year Adjustment: create/update")
  await expect("DELETE", "/api/duty/admin/year/adjustment", { year_key: "2026-2027", class_name: ctx.dutyClass }, 200, "Year Adjustment: delete")

  await classLogin("co_do", ctx.redClass)
  const created = await expect("POST", "/api/duty/create", undefined, [200, 400], "Duty Co Do: create current session")
  ctx.sessionId = created.data?.session_id
  await expect("GET", "/api/duty/current", undefined, [200, 400], "Duty Co Do: current")
  await expect("GET", "/api/duty/my/week", undefined, [200, 400], "Duty Co Do: my week")
  await expect("GET", "/api/duty/co_do/weeks", undefined, 200, "Duty Co Do: weeks")
  await expect("GET", `/api/duty/co_do/week/${ctx.weekId}`, undefined, 200, "Duty Co Do: week history")
  await expect("POST", "/api/ai/codo/parse", { dutyId: ctx.sessionId || 99999999, message: "QA" }, [400, 404, 500], "AI Co Do: parse validation/unavailable")
  await expect("GET", `/api/ai/codo/context/${ctx.sessionId || 99999999}`, undefined, [200, 404], "AI Co Do: context")

  await classLogin("bancansu", ctx.dutyClass)
  await expect("GET", "/api/duty/bancansu/weeks", undefined, 200, "Duty BCS: weeks")
  await expect("GET", `/api/duty/bancansu/week/${ctx.weekId}`, undefined, 200, "Duty BCS: week")
  await expect("GET", "/api/duty/bancansu/week", undefined, [200, 400], "Duty BCS: current week")

  await classLogin("gvcn", ctx.dutyClass)
  await expect("GET", "/api/duty/gvcn/weeks", undefined, 200, "Duty GVCN: weeks")
  await expect("GET", `/api/duty/gvcn/week/${ctx.weekId}`, undefined, 200, "Duty GVCN: week")
  await expect("GET", `/api/duty/gvcn/week/${ctx.weekId}/summary`, undefined, 200, "Duty GVCN: week summary")
}

async function testBonusAndAccount(ctx) {
  await adminLogin()
  await expectBlob("GET", "/api/bonus/admin/timetable/template", undefined, 200, "Timetable Excel: template")
  await expectBlob("GET", "/api/bonus/admin/so-dau-bai/template", undefined, 200, "So dau bai Excel: template")
  await expect("GET", "/api/bonus/admin/timetables", undefined, 200, "Timetable: list")
  await expect("GET", "/api/bonus/admin/timetable/99999999", undefined, [400, 404], "Timetable: read missing")
  await expect("POST", "/api/bonus/admin/upload-timetable", { file_data: "bad" }, 400, "Timetable: upload invalid")
  await expect("POST", "/api/bonus/admin/upload-zip", { week_id: ctx.weekId, file_data: "bad" }, 400, "So dau bai ZIP: upload invalid")
  await expect("GET", `/api/bonus/admin/upload-status?week_id=${ctx.weekId}`, undefined, 200, "Upload Status: list")
  await expect("POST", "/api/bonus/parse", {}, [400, 500], "Bonus Parser: validation")
  await expect("GET", `/api/bonus/eligibility?week_id=${ctx.weekId}&class_name=${encodeURIComponent(ctx.dutyClass)}`, undefined, [200, 400], "Bonus: eligibility")
  await expect("GET", `/api/bonus/co_do/eligibility?week_id=${ctx.weekId}`, undefined, [200, 403], "Bonus Co Do: permission/eligibility as admin")
  await expect("POST", "/api/bonus/apply-day", { week_id: ctx.weekId, date: "2027-08-03", class_name: ctx.dutyClass, points: 1, min_score: 0, source: "QA" }, 200, "Bonus: apply day")
  await expect("POST", "/api/bonus/apply-week", { week_id: ctx.weekId, class_name: ctx.dutyClass, points: 1, reason: "QA" }, 200, "Bonus: apply week")
  await expect("POST", "/api/bonus/admin/missing-logs/export", { week_id: ctx.weekId }, [200, 400], "Missing Logs: export")

  await classLogin("gvcn", ctx.dutyClass)
  await expect("GET", "/api/account/profile", undefined, 200, "Account: profile")
  await expect("POST", "/api/account/change-password", { old_password: "wrong", new_password: "short" }, [400, 401], "Account: change password validation")
}

async function cleanup(ctx) {
  await adminLogin()
  if (ctx.sessionId) await expect("DELETE", `/api/duty/admin/session/${ctx.sessionId}`, undefined, [200, 403, 404], "Cleanup: delete duty session")
  if (ctx.weekId) {
    await expect("POST", `/api/duty/admin/week/${ctx.weekId}/reopen`, undefined, [200, 404], "Cleanup: reopen week")
    await expect("DELETE", `/api/schedule/week/${ctx.weekId}`, undefined, [200, 403, 404, 409], "Cleanup: delete week")
  }
  if (ctx.monthId) await expect("DELETE", `/api/schedule/admin/months/${ctx.monthId}`, undefined, [200, 403, 404, 409], "Cleanup: delete month")
  if (ctx.semesterId) await expect("DELETE", `/api/schedule/admin/semesters/${ctx.semesterId}`, undefined, [200, 403, 404, 409], "Cleanup: delete semester")
  if (ctx.ruleId) await expect("DELETE", `/api/rules/${ctx.ruleId}`, undefined, [200, 409, 404], "Cleanup: delete rule")
  if (ctx.redClassId) await expect("DELETE", `/api/classes/${ctx.redClassId}`, undefined, [200, 409, 404], "Cleanup: delete red class")
  if (ctx.dutyClassId) await expect("DELETE", `/api/classes/${ctx.dutyClassId}`, undefined, [200, 409, 404], "Cleanup: delete duty class")
}

async function main() {
  const ctx = {}
  await startServer()
  try {
    await testAuthAndSettings()
    await testClassesAndRules(ctx)
    await testScheduleTime(ctx)
    await testDutyAndSummaries(ctx)
    await testBonusAndAccount(ctx)
  } finally {
    await cleanup(ctx).catch((err) => {
      fail("Cleanup: unexpected error", err.message)
    })
    stopServer()
  }

  const passed = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  console.log(`# API QA Smoke Report\n`)
  console.log(`PASS: ${passed.length}`)
  console.log(`FAIL: ${failed.length}\n`)
  for (const item of results) {
    console.log(`${item.ok ? "✅ PASS" : "❌ FAIL"} ${item.name}`)
    if (item.detail) console.log(`   ${item.detail}`)
  }
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  stopServer()
  console.error(err)
  process.exit(1)
})
