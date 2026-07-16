const { all, get } = require("../../utils/dbp")
const { buildCodoParsePrompt } = require("./promptBuilder")
const { validateCodoParseResponse } = require("./validator")

const isProduction = process.env.NODE_ENV === "production"

const fakeResponseText = JSON.stringify(
  {
    violations: [
      {
        ruleId: 4,
        quantity: 2,
        confidence: 0.98,
        matchedText: "đi trễ",
      },
    ],
  },
  null,
  2,
)

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
      SELECT id, name, score_delta
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
      minus_points: Math.abs(Number(rule.score_delta || 0)),
      allow_quantity: true,
      aliases: [],
    })),
  }
}

function parseModelResponse(text) {
  const raw = String(text || "").trim()
  let cleaned = raw

  const fencedMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim()
  }

  return JSON.parse(cleaned)
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

async function buildCodoParsePreview({ dutyId, message, redClass }) {
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
  logDevBlock("===== AI PROMPT =====", prompt)

  const rawResponse = fakeResponseText
  logDevBlock("===== AI RAW RESPONSE =====", rawResponse)

  const parsed = parseModelResponse(rawResponse)
  logDevBlock("===== AI PARSED =====", JSON.stringify(parsed, null, 2))

  const valid = validateAiResponse(parsed)
  logDevBlock("===== AI VALID =====", JSON.stringify(valid, null, 2))

  return {
    status: "not_implemented",
    prompt,
  }
}

async function parseWithGemini({ dutyId, message, redClass }) {
  const context = await loadCodoDutyContext({
    dutyId,
    redClass,
  })

  const prompt = await buildCodoParsePrompt({
    context,
    message,
  })

  // Phase 3 replacement point:
  // const rawResponse = await Gemini.generateContent(prompt)
  // const parsed = parseModelResponse(rawResponse)
  // return validateAiResponse(parsed)

  return {
    prompt,
    rawResponse: fakeResponseText,
  }
}

/*
Quick test cases for parseModelResponse() + validateAiResponse():

PASS:
{"violations":[{"ruleId":4,"quantity":2}]}

PASS:
```json
{"violations":[{"ruleId":4,"quantity":2}]}
```

FAIL:
abc

FAIL:
{"violations":[{"ruleId":"4"}]}

FAIL:
{"violations":[{"ruleId":4,"quantity":0}]}

FAIL:
{"violations":[{"ruleId":4,"quantity":2,"abc":123}]}
*/

module.exports = {
  fakeResponseText,
  loadCodoDutyContext,
  buildCodoParsePreview,
  parseModelResponse,
  validateAiResponse,
  parseWithGemini,
}
