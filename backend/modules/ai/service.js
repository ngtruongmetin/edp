const { all, get } = require("../../utils/dbp")
const { buildCodoParsePrompt } = require("./promptBuilder")
const { generateViolationJson } = require("./gemini")
const { validateCodoParseResponse } = require("./validator")

const isProduction = process.env.NODE_ENV === "production"

function normalizeDutyId(dutyId) {
  const parsed = Number(dutyId)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function logDevBlock(title, value) {
  if (isProduction) return

  console.log(title)
  console.log(value)
}

function logDevTextBlock(title, value) {
  if (isProduction) return

  console.log(title)
  console.log(String(value || ""))
  console.log("================================")
}

async function loadCodoDutyContext({ dutyId, redClass }) {
  const normalizedDutyId = normalizeDutyId(dutyId)
  if (!normalizedDutyId) {
    const error = new Error("Invalid dutyId")
    error.status = 400
    throw error
  }

  if (!redClass) {
    const error = new Error("Missing class")
    error.status = 400
    throw error
  }

  const duty = await get(
    `
      SELECT
        s.id,
        s.week_id,
        s.date,
        s.status,
        c.id as target_class_id,
        c.name as target_class_name
      FROM duty_sessions s
      JOIN schedule_assignments a
        ON a.week_id = s.week_id
       AND a.red_class = ?
       AND a.duty_class = s.duty_class
      LEFT JOIN classes c
        ON c.name = s.duty_class
      WHERE s.id = ?
      LIMIT 1
    `,
    [redClass, normalizedDutyId],
  )

  if (!duty) {
    const error = new Error("Duty session not found")
    error.status = 404
    throw error
  }

  const rules = await all(
    `
      SELECT id, name
      FROM rules
      ORDER BY category, id
    `,
    [],
  )

  return {
    duty: {
      id: duty.id,
      date: duty.date,
      status: duty.status,
    },
    targetClass: {
      id: duty.target_class_id,
      name: duty.target_class_name,
    },
    rules: (rules || []).map((rule) => ({
      id: Number(rule.id),
      name: String(rule.name || ""),
    })),
  }
}

async function loadCodoPromptPreviewContext() {
  const rules = await all(
    `
      SELECT id, name
      FROM rules
      ORDER BY category, id
    `,
    [],
  )

  return {
    duty: {
      id: 0,
      date: new Date().toISOString().slice(0, 10),
      status: "preview",
    },
    targetClass: {
      id: null,
      name: "10A8",
    },
    rules: (rules || []).map((rule) => ({
      id: Number(rule.id),
      name: String(rule.name || ""),
    })),
  }
}

function stripMarkdownFences(text) {
  const raw = String(text || "").trim()

  const fencedBlocks = Array.from(
    raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi),
  )

  if (fencedBlocks.length > 0) {
    return fencedBlocks.map((match) => String(match[1] || "").trim()).filter(Boolean)
  }

  const stripped = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim()

  return stripped ? [stripped] : []
}

function extractBalancedJson(text) {
  const raw = String(text || "")
  const startIndex = raw.search(/[\[{]/)

  if (startIndex < 0) {
    return null
  }

  const stack = []
  let inString = false
  let escaped = false

  for (let index = startIndex; index < raw.length; index += 1) {
    const char = raw[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === "\\") {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{" || char === "[") {
      stack.push(char)
      continue
    }

    if (char === "}" || char === "]") {
      const last = stack[stack.length - 1]
      const isMatchingPair =
        (last === "{" && char === "}") || (last === "[" && char === "]")

      if (!isMatchingPair) {
        return null
      }

      stack.pop()

      if (stack.length === 0) {
        return raw.slice(startIndex, index + 1).trim()
      }
    }
  }

  return null
}

function buildJsonCandidates(text) {
  const raw = String(text || "").trim()
  const candidates = []
  const seen = new Set()

  function pushCandidate(value) {
    const normalized = String(value || "").trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  pushCandidate(raw)

  for (const candidate of stripMarkdownFences(raw)) {
    pushCandidate(candidate)
  }

  const balancedFromRaw = extractBalancedJson(raw)
  if (balancedFromRaw) {
    pushCandidate(balancedFromRaw)
  }

  for (const candidate of [...candidates]) {
    const balanced = extractBalancedJson(candidate)
    if (balanced) {
      pushCandidate(balanced)
    }
  }

  return candidates
}

function createInvalidModelJsonError(rawResponse, cause) {
  const error = new Error("Gemini trả về JSON không hợp lệ.")
  error.status = 500
  error.invalidModelJson = true
  error.publicMessage = "Gemini trả về JSON không hợp lệ."
  error.rawResponse = String(rawResponse || "")
  error.cause = cause
  return error
}

function parseModelResponse(text) {
  const raw = String(text || "").trim()
  const candidates = buildJsonCandidates(raw)
  let lastParseError = null

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch (err) {
      lastParseError = err
    }
  }

  throw createInvalidModelJsonError(raw, lastParseError)
}

function validateAiResponse(data) {
  const valid = validateCodoParseResponse(data)

  if (!valid) {
    const error = new Error("Invalid AI response")
    error.details = validateCodoParseResponse.errors || []
    throw error
  }

  return data
}

async function parseCodoMessage({ dutyId, message, redClass }) {
  const trimmedMessage = String(message || "").trim()
  if (!trimmedMessage) {
    const error = new Error("Missing message")
    error.status = 400
    throw error
  }

  const context = await loadCodoDutyContext({ dutyId, redClass })
  logDevBlock("===== AI CONTEXT =====", JSON.stringify(context, null, 2))

  const prompt = await buildCodoParsePrompt({
    context,
    message: trimmedMessage,
  })
  logDevTextBlock("===== AI PROMPT =====", prompt)

  const rawResponse = await generateViolationJson(prompt)
  logDevTextBlock("===== GEMINI RAW RESPONSE =====", rawResponse)

  const parsed = parseModelResponse(rawResponse)
  logDevBlock("===== AI PARSED =====", JSON.stringify(parsed, null, 2))
  logDevBlock(
    "===== AI RULE IDS =====",
    JSON.stringify(
      Array.isArray(parsed?.violations)
        ? parsed.violations.map((item) => ({
            ruleId: item?.ruleId ?? null,
          }))
        : [],
      null,
      2,
    ),
  )

  const valid = validateAiResponse(parsed)
  logDevBlock("===== AI VALID =====", JSON.stringify(valid, null, 2))

  return valid
}

async function buildCodoPromptPreview({ message }) {
  const trimmedMessage = String(message || "").trim()
  if (!trimmedMessage) {
    const error = new Error("Missing message")
    error.status = 400
    throw error
  }

  const context = await loadCodoPromptPreviewContext()
  const prompt = await buildCodoParsePrompt({
    context,
    message: trimmedMessage,
  })

  return {
    context,
    prompt,
  }
}

module.exports = {
  loadCodoDutyContext,
  buildCodoPromptPreview,
  parseModelResponse,
  validateAiResponse,
  parseCodoMessage,
}
