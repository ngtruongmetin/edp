const db = require("../db")
const time = require("./time")

const WEEK_STATUSES = Object.freeze({
  NOT_SUMMARIZED: "not_summarized",
  LIMITED_EDIT: "limited_edit",
  SUMMARIZED: "summarized",
})

function normalizeDateTime(input, fallbackDate = null, fallbackTime = "00:00:00") {
  const value = String(input || "").trim()
  if (!value && fallbackDate) return `${fallbackDate} ${fallbackTime}`

  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) {
    match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    if (match) {
      match = [match[0], match[3], match[2], match[1], match[4], match[5], match[6]]
    }
  }
  if (!match) return null

  const [, year, month, day, hours = fallbackTime.slice(0, 2), minutes = fallbackTime.slice(3, 5), seconds = fallbackTime.slice(6, 8)] = match
  const date = `${year}-${month}-${day}`
  const parsed = new Date(`${date}T${hours}:${minutes}:${seconds}`)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getFullYear() !== Number(year) || parsed.getMonth() + 1 !== Number(month) || parsed.getDate() !== Number(day)) return null
  return `${date} ${hours}:${minutes}:${seconds}`
}

function datePart(dateTime, fallback = null) {
  const value = String(dateTime || "")
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : fallback
}

function statusForWeek(week, now = time.now()) {
  if (week?.status === WEEK_STATUSES.SUMMARIZED || week?.closed_at) return WEEK_STATUSES.SUMMARIZED
  if (week?.status === WEEK_STATUSES.LIMITED_EDIT) return WEEK_STATUSES.LIMITED_EDIT
  const end = normalizeDateTime(week?.end_datetime, week?.end_date, "23:59:59")
  return end && String(now) >= end ? WEEK_STATUSES.LIMITED_EDIT : WEEK_STATUSES.NOT_SUMMARIZED
}

function syncWeekStatus(weekId, callback) {
  db.get(
    `
      SELECT w.id, w.status, w.start_date, w.end_date, w.start_datetime, w.end_datetime, c.closed_at
      FROM schedule_weeks w
      LEFT JOIN week_closings c ON c.week_id = w.id
      WHERE w.id=?
      LIMIT 1
    `,
    [weekId],
    (error, week) => {
      if (error) return callback(error)
      if (!week) return callback(null, null)
      const nextStatus = statusForWeek(week)
      if (nextStatus === week.status) return callback(null, { ...week, status: nextStatus })
      db.run(
        `UPDATE schedule_weeks SET status=? WHERE id=?`,
        [nextStatus, week.id],
        (updateError) => {
          if (updateError) return callback(updateError)
          callback(null, { ...week, status: nextStatus })
        },
      )
    },
  )
}

function syncAllWeekStatuses(callback) {
  db.run(
    `
      UPDATE schedule_weeks w
      SET status = CASE
        WHEN EXISTS (SELECT 1 FROM week_closings c WHERE c.week_id=w.id AND c.closed_at IS NOT NULL) THEN ?
        WHEN COALESCE(w.end_datetime, w.end_date || ' 23:59:59') <= ? THEN ?
        ELSE COALESCE(NULLIF(w.status, ''), ?)
      END
    `,
    [WEEK_STATUSES.SUMMARIZED, time.now(), WEEK_STATUSES.LIMITED_EDIT, WEEK_STATUSES.NOT_SUMMARIZED],
    (error) => callback(error),
  )
}

module.exports = {
  WEEK_STATUSES,
  normalizeDateTime,
  datePart,
  statusForWeek,
  syncWeekStatus,
  syncAllWeekStatuses,
}
