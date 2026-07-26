const { pool } = require("../../config/database")
const { generateAiText } = require("../ai/gemini")
const { WEEKLY_SUMMARY_TASK, buildWeeklySummaryContext, createHttpError } = require("./contextBuilder")
const { buildWeeklySummaryPrompt } = require("./promptBuilder")

function normalizeWeekId(value) {
  const weekId = Number(value)
  return Number.isInteger(weekId) && weekId > 0 ? weekId : null
}

function normalizeClassId(value) {
  if (value === undefined || value === null || value === "") return null
  const classId = Number(value)
  return Number.isInteger(classId) && classId > 0 ? classId : null
}

function sanitizeMarkdownResponse(value) {
  const raw = String(value || "").trim()
  const hasOpenReasoningTag = /<think>/i.test(raw)
  const hasCloseReasoningTag = /<\/think>/i.test(raw)

  if (hasOpenReasoningTag && !hasCloseReasoningTag) {
    throw createHttpError(502, "AI chưa hoàn tất báo cáo phân tích. Vui lòng thử lại.")
  }

  const content = raw.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim()
  if (!content) {
    throw createHttpError(502, "AI không trả về nội dung phân tích.")
  }

  return content
}

function isoNow() {
  return new Date().toISOString()
}

async function resolveTaskAccess({ task, weekId, requestedClassId, user }) {
  if (task !== WEEKLY_SUMMARY_TASK) {
    throw createHttpError(400, "Tác vụ AI không được hỗ trợ.")
  }

  const normalizedWeekId = normalizeWeekId(weekId)
  if (!normalizedWeekId) {
    throw createHttpError(400, "Tuần phân tích không hợp lệ.")
  }

  const classId = normalizeClassId(user?.class_id)
  const className = String(user?.class_name || "").trim()
  if (!classId || !className) {
    throw createHttpError(403, "Không thể xác định lớp chủ nhiệm.")
  }

  const normalizedRequestedClassId = normalizeClassId(requestedClassId)
  if (requestedClassId !== undefined && !normalizedRequestedClassId) {
    throw createHttpError(400, "Lớp yêu cầu không hợp lệ.")
  }
  if (normalizedRequestedClassId && normalizedRequestedClassId !== classId) {
    throw createHttpError(403, "Bạn chỉ có quyền phân tích lớp chủ nhiệm của mình.")
  }

  const weekResult = await pool.query(
    "SELECT id FROM schedule_weeks WHERE id = $1 LIMIT 1",
    [normalizedWeekId],
  )
  if (!weekResult.rows[0]) {
    throw createHttpError(404, "Không tìm thấy tuần được yêu cầu.")
  }

  return { classId, className, weekId: normalizedWeekId }
}

async function findCachedReport({ classId, weekId, task }) {
  const result = await pool.query(
    `
      SELECT content, generated_at, updated_at
      FROM gvcn_ai_weekly_reports
      WHERE class_id = $1 AND week_id = $2 AND task = $3
      LIMIT 1
    `,
    [classId, weekId, task],
  )
  return result.rows[0] || null
}

async function saveReport({ classId, weekId, task, content, generatedAt }) {
  const updatedAt = isoNow()
  await pool.query(
    `
      INSERT INTO gvcn_ai_weekly_reports (
        class_id, week_id, task, content, generated_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (class_id, week_id, task)
      DO UPDATE SET
        content = EXCLUDED.content,
        generated_at = EXCLUDED.generated_at,
        updated_at = EXCLUDED.updated_at
    `,
    [classId, weekId, task, content, generatedAt, updatedAt],
  )
  return { generatedAt, updatedAt }
}

async function getGvcnAiReport({ task, weekId, requestedClassId, force = false, user }) {
  const access = await resolveTaskAccess({ task, weekId, requestedClassId, user })
  const cached = await findCachedReport({
    classId: access.classId,
    weekId: access.weekId,
    task,
  })

  if (cached && !force) {
    return {
      content: cached.content,
      cached: true,
      generatedAt: cached.generated_at,
      updatedAt: cached.updated_at,
    }
  }

  const context = await buildWeeklySummaryContext(access)
  const prompt = await buildWeeklySummaryPrompt(context)
  const content = sanitizeMarkdownResponse(await generateAiText(prompt))
  const timestamps = await saveReport({
    classId: access.classId,
    weekId: access.weekId,
    task,
    content,
    generatedAt: context.generatedAt,
  })

  return {
    content,
    cached: false,
    ...timestamps,
  }
}

module.exports = {
  getGvcnAiReport,
}
