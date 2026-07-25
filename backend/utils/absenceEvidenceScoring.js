const { pool } = require("../config/database")

function exemptedViolationQuantitySql(violationAlias = "v") {
  return `
    COALESCE((
      SELECT SUM(exemption.approved_quantity)
      FROM absence_exemption_logs exemption
      WHERE exemption.duty_violation_id = ${violationAlias}.id
    ), 0)
  `
}

function effectiveViolationQuantitySql(violationAlias = "v") {
  return `
    GREATEST(
      COALESCE(${violationAlias}.quantity, 0) - ${exemptedViolationQuantitySql(violationAlias)},
      0
    )
  `
}

function effectiveViolationScoreSql(violationAlias = "v", ruleAlias = "r") {
  return `
    COALESCE(SUM(
      ${ruleAlias}.score_delta * ${effectiveViolationQuantitySql(violationAlias)}
    ), 0)
  `
}

async function getWeekScores(weekId) {
  const baseSetting = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'base_score' LIMIT 1`,
  )
  const baseScore = Number(baseSetting.rows[0]?.setting_value || 100)
  const scores = await pool.query(
    `
      WITH class_list AS (
        SELECT name AS class_name
        FROM classes
        WHERE is_active = 1
      ),
      session_base AS (
        SELECT
          s.id,
          s.duty_class AS class_name,
          ${effectiveViolationScoreSql("v", "r")} AS violation_score,
          COALESCE(MAX(b.points), 0) AS bonus_points
        FROM duty_sessions s
        LEFT JOIN duty_violations v ON v.session_id = s.id
        LEFT JOIN rules r ON r.id = v.rule_id
        LEFT JOIN daily_bonus b
          ON b.week_id = s.week_id
         AND b.date = s.date
         AND b.class_name = s.duty_class
        WHERE s.week_id = $1
          AND s.status = 'signed'
        GROUP BY s.id, s.duty_class
      ),
      class_totals AS (
        SELECT class_name, SUM(violation_score + bonus_points) AS session_score
        FROM session_base
        GROUP BY class_name
      )
      SELECT
        classes.class_name,
        ($2 + COALESCE(class_totals.session_score, 0) + COALESCE(weekly_bonus.points, 0)) AS score
      FROM class_list classes
      LEFT JOIN class_totals ON class_totals.class_name = classes.class_name
      LEFT JOIN weekly_bonus
        ON weekly_bonus.week_id = $1
       AND weekly_bonus.class_name = classes.class_name
      ORDER BY score DESC, classes.class_name ASC
    `,
    [weekId, Number.isFinite(baseScore) ? baseScore : 100],
  )

  return scores.rows
}

async function recalculateWeekScores(weekId) {
  const scores = await getWeekScores(weekId)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`DELETE FROM weekly_scores WHERE week_id = $1`, [weekId])
    for (const row of scores) {
      await client.query(
        `INSERT INTO weekly_scores (week_id, class_name, score, updated_at) VALUES ($1, $2, $3, $4)`,
        [weekId, row.class_name, Number(row.score || 0), new Date().toISOString()],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }

  return scores
}

function parseWeekIds(value) {
  try {
    const ids = JSON.parse(String(value || "[]"))
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : []
  } catch {
    return []
  }
}

async function applyExemptionToClosedPeriodCaches(weekId, className, scoreAdjustment) {
  if (!scoreAdjustment) return

  const periods = [
    { summary: "month_summaries", key: "month_key", scores: "month_scores" },
    { summary: "semester_summaries", key: "semester_key", scores: "semester_scores" },
    { summary: "year_summaries", key: "year_key", scores: "year_scores" },
  ]

  for (const period of periods) {
    const result = await pool.query(
      `SELECT ${period.key} AS period_key, week_ids FROM ${period.summary} WHERE closed_at IS NOT NULL`,
    )
    const affectedKeys = result.rows
      .filter((row) => parseWeekIds(row.week_ids).includes(Number(weekId)))
      .map((row) => row.period_key)

    for (const key of affectedKeys) {
      await pool.query(
        `
          UPDATE ${period.scores}
          SET minus_points = GREATEST(COALESCE(minus_points, 0) - $1, 0),
              total_score = COALESCE(total_score, 0) + $1,
              updated_at = $2
          WHERE ${period.key} = $3
            AND class_name = $4
        `,
        [scoreAdjustment, new Date().toISOString(), key, className],
      )
      await pool.query(
        `
          WITH ranked AS (
            SELECT
              class_name,
              RANK() OVER (PARTITION BY grade ORDER BY total_score DESC, class_name ASC) AS calculated_rank
            FROM ${period.scores}
            WHERE ${period.key} = $1
          )
          UPDATE ${period.scores} scores
          SET rank = ranked.calculated_rank
          FROM ranked
          WHERE scores.${period.key} = $1
            AND scores.class_name = ranked.class_name
        `,
        [key],
      )
    }
  }
}

module.exports = {
  exemptedViolationQuantitySql,
  effectiveViolationQuantitySql,
  effectiveViolationScoreSql,
  getWeekScores,
  recalculateWeekScores,
  applyExemptionToClosedPeriodCaches,
}
