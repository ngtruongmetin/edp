const { pool } = require("../../config/database")
const { effectiveViolationQuantitySql, getWeekScores } = require("../../utils/absenceEvidenceScoring")

const WEEKLY_SUMMARY_TASK = "weekly-summary"

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function asNumber(value) {
  return Number(value || 0)
}

function parseJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function normalizeNote(value) {
  return String(value || "").trim()
}

function normalizeComparableText(value) {
  return String(value || "")
    .replace(/\u0110/g, "D")
    .replace(/\u0111/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function extractStudentNamesFromNote(value) {
  const note = normalizeNote(value)
  if (isPlaceholderNote(note)) return []

  const candidate = note
    .replace(/^(?:h\u1ecdc\s+sinh|hs|em)\s*[:\-]\s*/iu, "")
    .trim()
  const namePattern = /^\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){1,5}$/u
  const names = new Set()

  for (const part of candidate.split(/[,;\n]|\s+(?:v\u00e0|va|&)\s+/iu)) {
    const name = part.replace(/\s+/g, " ").trim()
    if (namePattern.test(name)) names.add(name)
  }

  return [...names]
}

function isPlaceholderNote(value) {
  const normalized = normalizeComparableText(value)
  return !normalized || normalized === "khong" || normalized === "n/a"
}

function rankScores(scores, className) {
  const rows = (scores || []).map((row) => ({
    className: String(row.class_name || ""),
    grade: Number.parseInt(String(row.class_name || ""), 10) || 0,
    score: asNumber(row.score),
  }))

  const byGrade = new Map()
  for (const row of rows) {
    const gradeRows = byGrade.get(row.grade) || []
    gradeRows.push(row)
    byGrade.set(row.grade, gradeRows)
  }

  const rankings = []
  for (const [grade, gradeRows] of byGrade) {
    gradeRows.sort((a, b) => b.score - a.score || a.className.localeCompare(b.className))
    let previousScore = null
    let rank = 0
    gradeRows.forEach((row, index) => {
      if (previousScore === null || row.score !== previousScore) rank = index + 1
      previousScore = row.score
      rankings.push({ ...row, grade, rank })
    })
  }

  const current = rankings.find((row) => row.className === className) || null
  return {
    current: current
      ? { score: current.score, rank: current.rank, grade: current.grade, classCount: rankings.filter((row) => row.grade === current.grade).length }
      : { score: null, rank: null, grade: Number.parseInt(className, 10) || null, classCount: 0 },
    gradeRanking: current
      ? rankings
          .filter((row) => row.grade === current.grade)
          .map(({ className: rankedClassName, score, rank }) => ({ className: rankedClassName, score, rank }))
      : [],
  }
}

function buildViolationStatistics(violations) {
  const byType = new Map()
  const byRecordedNote = new Map()
  const byStudent = new Map()

  for (const violation of violations) {
    const effectiveQuantity = asNumber(violation.effective_quantity)
    if (!effectiveQuantity) continue

    const scoreImpact = asNumber(violation.score_delta) * effectiveQuantity
    const typeKey = `${violation.rule_id}:${violation.rule_name}`
    const currentType = byType.get(typeKey) || {
      ruleId: asNumber(violation.rule_id),
      category: violation.category || "Chưa phân loại",
      name: violation.rule_name || "Quy định không xác định",
      occurrences: 0,
      quantity: 0,
      scoreImpact: 0,
      dates: new Set(),
    }
    currentType.occurrences += 1
    currentType.quantity += effectiveQuantity
    currentType.scoreImpact += scoreImpact
    currentType.dates.add(violation.date)
    byType.set(typeKey, currentType)

    const note = normalizeNote(violation.note)
    if (!isPlaceholderNote(note)) {
      const currentNote = byRecordedNote.get(note) || {
        note,
        occurrences: 0,
        quantity: 0,
        scoreImpact: 0,
        violationTypes: new Set(),
      }
      currentNote.occurrences += 1
      currentNote.quantity += effectiveQuantity
      currentNote.scoreImpact += scoreImpact
      currentNote.violationTypes.add(violation.rule_name || "Quy định không xác định")
      byRecordedNote.set(note, currentNote)
    }

    for (const studentName of extractStudentNamesFromNote(note)) {
      const studentKey = normalizeComparableText(studentName)
      const student = byStudent.get(studentKey) || {
        studentName,
        violationOccurrences: 0,
        effectiveQuantity: 0,
        scoreImpact: 0,
        violations: new Map(),
      }
      const studentViolation = student.violations.get(typeKey) || {
        category: violation.category || "Chưa phân loại",
        name: violation.rule_name || "Quy định không xác định",
        occurrences: 0,
        effectiveQuantity: 0,
        scoreImpact: 0,
        dates: new Set(),
      }

      student.violationOccurrences += 1
      student.effectiveQuantity += effectiveQuantity
      student.scoreImpact += scoreImpact
      studentViolation.occurrences += 1
      studentViolation.effectiveQuantity += effectiveQuantity
      studentViolation.scoreImpact += scoreImpact
      studentViolation.dates.add(violation.date)
      student.violations.set(typeKey, studentViolation)
      byStudent.set(studentKey, student)
    }
  }

  const violationsByType = [...byType.values()]
    .map((item) => ({
      ...item,
      dateCount: item.dates.size,
      dates: [...item.dates].sort(),
    }))
    .sort((a, b) => a.scoreImpact - b.scoreImpact || b.quantity - a.quantity || a.name.localeCompare(b.name))

  const violationsByRecordedNote = [...byRecordedNote.values()]
    .map((item) => ({ ...item, violationTypes: [...item.violationTypes].sort() }))
    .sort((a, b) => a.scoreImpact - b.scoreImpact || b.quantity - a.quantity || a.note.localeCompare(b.note))

  const students = [...byStudent.values()]
    .map((student) => ({
      studentName: student.studentName,
      violationOccurrences: student.violationOccurrences,
      effectiveQuantity: student.effectiveQuantity,
      scoreImpact: student.scoreImpact,
      violations: [...student.violations.values()]
        .map((violation) => ({ ...violation, dates: [...violation.dates].sort() }))
        .sort((a, b) => a.scoreImpact - b.scoreImpact || b.effectiveQuantity - a.effectiveQuantity || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.violationOccurrences - a.violationOccurrences || a.scoreImpact - b.scoreImpact || a.studentName.localeCompare(b.studentName))

  return {
    violationsByType,
    violationsByRecordedNote,
    studentsFromNotes: {
      students,
      repeatOffenders: students.filter((student) => student.violationOccurrences >= 2),
      extractionRule: "Chỉ ghi nhận các ghi chú gồm một hoặc nhiều tên riêng rõ ràng, viết hoa từng từ và ngăn cách bằng dấu phẩy, chấm phẩy hoặc từ nối 'và'.",
    },
    totals: {
      effectiveQuantity: violationsByType.reduce((sum, item) => sum + item.quantity, 0),
      scoreImpact: violationsByType.reduce((sum, item) => sum + item.scoreImpact, 0),
      typeCount: violationsByType.length,
      recordedNoteCount: violationsByRecordedNote.length,
      identifiedStudentCount: students.length,
    },
  }
}

function buildDailySummary(sessionReports) {
  const daily = new Map()

  for (const session of sessionReports) {
    const current = daily.get(session.date) || {
      date: session.date,
      sessionCount: 0,
      signedSessionCount: 0,
      draftSessionCount: 0,
      violationQuantity: 0,
      violationScoreImpact: 0,
      dailyBonusPoints: 0,
      totalScoreImpact: 0,
      violationTypes: new Set(),
    }
    current.sessionCount += 1
    if (session.status === "signed") current.signedSessionCount += 1
    else current.draftSessionCount += 1
    current.violationQuantity += session.violationQuantity
    current.violationScoreImpact += session.violationScoreImpact
    current.dailyBonusPoints += session.dailyBonusPoints
    current.totalScoreImpact += session.violationScoreImpact + session.dailyBonusPoints
    session.violations.forEach((violation) => {
      if (violation.effectiveQuantity > 0) current.violationTypes.add(violation.ruleName)
    })
    daily.set(session.date, current)
  }

  return [...daily.values()]
    .map((item) => ({ ...item, violationTypes: [...item.violationTypes].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function buildSessionReports(sessions, violations, dailyBonuses, dutyEvidenceBySession) {
  const violationsBySession = new Map()
  for (const violation of violations) {
    const sessionViolations = violationsBySession.get(violation.session_id) || []
    const quantity = asNumber(violation.quantity)
    const exemptedQuantity = asNumber(violation.exempted_quantity)
    const effectiveQuantity = asNumber(violation.effective_quantity)
    sessionViolations.push({
      category: violation.category || "Chưa phân loại",
      ruleName: violation.rule_name || "Quy định không xác định",
      scoreDelta: asNumber(violation.score_delta),
      quantity,
      exemptedQuantity,
      effectiveQuantity,
      scoreImpact: asNumber(violation.score_delta) * effectiveQuantity,
      note: normalizeNote(violation.note) || null,
    })
    violationsBySession.set(violation.session_id, sessionViolations)
  }

  const bonusByDate = new Map(dailyBonuses.map((bonus) => [bonus.date, bonus]))

  return sessions.map((session) => {
    const sessionViolations = violationsBySession.get(session.id) || []
    const bonus = bonusByDate.get(session.date)
    const dutyEvidence = dutyEvidenceBySession.get(session.id) || { count: 0, files: [] }
    const violationQuantity = sessionViolations.reduce((sum, item) => sum + item.effectiveQuantity, 0)
    const violationScoreImpact = sessionViolations.reduce((sum, item) => sum + item.scoreImpact, 0)
    return {
      date: session.date,
      redClass: session.red_class,
      status: session.status,
      signedAt: session.signed_at || null,
      violationQuantity,
      violationScoreImpact,
      dailyBonusPoints: asNumber(bonus?.points),
      dailyBonusSource: bonus?.source || null,
      dutyEvidence: dutyEvidence,
      signatureEvidenceCount: asNumber(session.signature_evidence_count),
      violations: sessionViolations,
    }
  })
}

async function getWeekData(weekId, className) {
  const effectiveQuantitySql = effectiveViolationQuantitySql("v")
  const [sessionsResult, violationsResult, dailyBonusesResult, weeklyBonusResult, dutyEvidenceResult, absenceEvidencesResult] = await Promise.all([
    pool.query(
      `
        SELECT
          s.id,
          s.date,
          s.red_class,
          s.status,
          s.signed_at,
          (SELECT COUNT(*) FROM duty_signatures signature WHERE signature.session_id = s.id) AS signature_evidence_count
        FROM duty_sessions s
        WHERE s.week_id = $1
          AND s.duty_class = $2
        ORDER BY s.date ASC, s.id ASC
      `,
      [weekId, className],
    ),
    pool.query(
      `
        SELECT
          v.id,
          v.session_id,
          s.date,
          v.rule_id,
          r.category,
          r.name AS rule_name,
          r.score_delta,
          COALESCE(v.quantity, 0) AS quantity,
          v.note,
          COALESCE((
            SELECT SUM(exemption.approved_quantity)
            FROM absence_exemption_logs exemption
            WHERE exemption.duty_violation_id = v.id
          ), 0) AS exempted_quantity,
          ${effectiveQuantitySql} AS effective_quantity
        FROM duty_violations v
        JOIN duty_sessions s ON s.id = v.session_id
        JOIN rules r ON r.id = v.rule_id
        WHERE s.week_id = $1
          AND s.duty_class = $2
        ORDER BY s.date ASC, v.id ASC
      `,
      [weekId, className],
    ),
    pool.query(
      `
        SELECT date, points, min_score, all_above_9, source, periods_json
        FROM daily_bonus
        WHERE week_id = $1
          AND class_name = $2
        ORDER BY date ASC
      `,
      [weekId, className],
    ),
    pool.query(
      `
        SELECT points, reason, created_at, updated_at
        FROM weekly_bonus
        WHERE week_id = $1
          AND class_name = $2
        LIMIT 1
      `,
      [weekId, className],
    ),
    pool.query(
      `
        SELECT session_id, file_name, mime_type
        FROM duty_evidence_images
        WHERE session_id IN (
          SELECT id FROM duty_sessions WHERE week_id = $1 AND duty_class = $2
        )
        ORDER BY session_id ASC, sort_order ASC, id ASC
      `,
      [weekId, className],
    ),
    pool.query(
      `
        SELECT
          evidence.student_name,
          evidence.start_date,
          evidence.end_date,
          evidence.note,
          evidence.status,
          evidence.submitted_at,
          evidence.review_reason,
          evidence.approved_exemption_count,
          COUNT(files.id) AS file_count
        FROM absence_evidences evidence
        LEFT JOIN absence_evidence_files files ON files.evidence_id = evidence.id
        WHERE evidence.week_id = $1
          AND evidence.class_id = (
            SELECT id FROM classes WHERE name = $2 LIMIT 1
          )
        GROUP BY evidence.id
        ORDER BY evidence.submitted_at ASC, evidence.id ASC
      `,
      [weekId, className],
    ),
  ])

  const dutyEvidenceBySession = new Map()
  for (const row of dutyEvidenceResult.rows) {
    const current = dutyEvidenceBySession.get(row.session_id) || { count: 0, files: [] }
    current.count += 1
    current.files.push({ fileName: row.file_name, mimeType: row.mime_type })
    dutyEvidenceBySession.set(row.session_id, current)
  }

  const dailyBonuses = dailyBonusesResult.rows.map((row) => ({
    date: row.date,
    points: asNumber(row.points),
    minimumScore: row.min_score === null ? null : asNumber(row.min_score),
    allAboveNine: row.all_above_9 === null ? null : Boolean(row.all_above_9),
    source: row.source || null,
    periods: parseJson(row.periods_json, null),
  }))

  return {
    sessions: sessionsResult.rows,
    violations: violationsResult.rows,
    dailyBonuses,
    weeklyBonus: weeklyBonusResult.rows[0]
      ? {
          points: asNumber(weeklyBonusResult.rows[0].points),
          reason: weeklyBonusResult.rows[0].reason || null,
          createdAt: weeklyBonusResult.rows[0].created_at || null,
          updatedAt: weeklyBonusResult.rows[0].updated_at || null,
        }
      : null,
    dutyEvidenceBySession,
    absenceEvidences: absenceEvidencesResult.rows.map((row) => ({
      studentName: row.student_name,
      startDate: row.start_date,
      endDate: row.end_date,
      note: row.note || null,
      status: row.status,
      submittedAt: row.submitted_at,
      reviewReason: row.review_reason || null,
      approvedExemptionCount: asNumber(row.approved_exemption_count),
      fileCount: asNumber(row.file_count),
    })),
  }
}

async function buildPreviousWeekComparison(week, className) {
  const previousWeekResult = await pool.query(
    `
      SELECT id, week_number, start_date, end_date
      FROM schedule_weeks
      WHERE start_date < $1
      ORDER BY start_date DESC, id DESC
      LIMIT 1
    `,
    [week.start_date],
  )
  const previousWeek = previousWeekResult.rows[0]
  if (!previousWeek) return { available: false, reason: "Không có tuần trước trong hệ thống." }

  const [previousData, previousScores] = await Promise.all([
    getWeekData(previousWeek.id, className),
    getWeekScores(previousWeek.id),
  ])
  const previousStatistics = buildViolationStatistics(previousData.violations)
  const previousRanking = rankScores(previousScores, className)

  return {
    available: true,
    week: {
      id: asNumber(previousWeek.id),
      number: previousWeek.week_number,
      startDate: previousWeek.start_date,
      endDate: previousWeek.end_date,
    },
    score: previousRanking.current,
    statistics: previousStatistics.totals,
    violationsByType: previousStatistics.violationsByType,
    sessionStatus: {
      total: previousData.sessions.length,
      signed: previousData.sessions.filter((session) => session.status === "signed").length,
      draft: previousData.sessions.filter((session) => session.status !== "signed").length,
    },
  }
}

async function buildWeeklySummaryContext({ weekId, classId, className }) {
  const [classResult, weekResult, rulesResult, baseScoreResult] = await Promise.all([
    pool.query(`SELECT id, name, grade, is_active FROM classes WHERE id = $1 AND name = $2 AND is_active = 1 LIMIT 1`, [classId, className]),
    pool.query(
      `
        SELECT
          week.id,
          week.week_number,
          week.start_date,
          week.end_date,
          closing.closed_at,
          month.month_key,
          month.name AS month_name,
          semester.semester_number,
          semester.name AS semester_name,
          school_year.name AS school_year_name
        FROM schedule_weeks week
        LEFT JOIN week_closings closing ON closing.week_id = week.id
        LEFT JOIN months month ON month.id = week.month_id
        LEFT JOIN semesters semester ON semester.id = month.semester_id
        LEFT JOIN school_years school_year ON school_year.id = semester.school_year_id
        WHERE week.id = $1
        LIMIT 1
      `,
      [weekId],
    ),
    pool.query(`SELECT id, category, name, score_delta FROM rules ORDER BY category ASC, id ASC`),
    pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'base_score' LIMIT 1`),
  ])

  const classRow = classResult.rows[0]
  if (!classRow) throw createHttpError(403, "Không thể xác minh lớp chủ nhiệm.")
  const week = weekResult.rows[0]
  if (!week) throw createHttpError(404, "Không tìm thấy tuần được yêu cầu.")

  const [weekData, scores] = await Promise.all([getWeekData(weekId, className), getWeekScores(weekId)])
  const sessionReports = buildSessionReports(
    weekData.sessions,
    weekData.violations,
    weekData.dailyBonuses,
    weekData.dutyEvidenceBySession,
  )
  const violationStatistics = buildViolationStatistics(weekData.violations)
  const ranking = rankScores(scores, className)
  const previousWeek = await buildPreviousWeekComparison(week, className)
  const signedSessions = sessionReports.filter((session) => session.status === "signed")
  const draftSessions = sessionReports.filter((session) => session.status !== "signed")

  return {
    task: WEEKLY_SUMMARY_TASK,
    generatedAt: new Date().toISOString(),
    class: {
      id: asNumber(classRow.id),
      name: classRow.name,
      grade: asNumber(classRow.grade),
    },
    week: {
      id: asNumber(week.id),
      number: week.week_number,
      startDate: week.start_date,
      endDate: week.end_date,
      closedAt: week.closed_at || null,
      month: week.month_key ? { key: week.month_key, name: week.month_name || null } : null,
      semester: week.semester_number ? { number: asNumber(week.semester_number), name: week.semester_name || null } : null,
      schoolYear: week.school_year_name || null,
    },
    dataAvailability: {
      studentDirectory: false,
      studentIdentitySource: "Tên học sinh chỉ xuất hiện trong trường ghi chú của phiếu trực hoặc minh chứng nghỉ học; hệ thống không có danh mục học sinh riêng.",
      dutyEvidence: true,
      absenceEvidence: true,
      previousWeek: previousWeek.available,
    },
    scoring: {
      basePoints: asNumber(baseScoreResult.rows[0]?.setting_value || 100),
      currentWeekScore: ranking.current,
      gradeRanking: ranking.gradeRanking,
      dailyBonuses: weekData.dailyBonuses,
      weeklyBonus: weekData.weeklyBonus,
    },
    sessionStatus: {
      total: sessionReports.length,
      signed: signedSessions.length,
      draft: draftSessions.length,
    },
    statistics: violationStatistics.totals,
    violationsByType: violationStatistics.violationsByType,
    violationsByRecordedNote: violationStatistics.violationsByRecordedNote,
    studentsFromNotes: violationStatistics.studentsFromNotes,
    dailySummary: buildDailySummary(sessionReports),
    sessions: sessionReports,
    absenceEvidences: weekData.absenceEvidences,
    rules: rulesResult.rows.map((rule) => ({
      category: rule.category || "Chưa phân loại",
      name: rule.name,
      scoreDelta: asNumber(rule.score_delta),
    })),
    previousWeek,
  }
}

module.exports = {
  WEEKLY_SUMMARY_TASK,
  buildWeeklySummaryContext,
  createHttpError,
}
