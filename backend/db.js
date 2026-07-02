const { AsyncLocalStorage } = require("async_hooks")
const { pool } = require("./config/database")

const contextStorage = new AsyncLocalStorage()

const TABLES_WITH_ID = new Set([
  "classes",
  "rules",
  "admins",
  "schedule_weeks",
  "accounts",
  "schedule_assignments",
  "duty_sessions",
  "duty_violations",
  "duty_signatures",
  "duty_revision_logs",
  "daily_bonus",
  "bonus_uploads",
  "timetables",
  "timetable_entries",
  "weekly_scores",
])

function stripLeadingWhitespace(sql) {
  return String(sql || "").replace(/^\s+/, "")
}

function isBeginStatement(sql) {
  return /^BEGIN\b/i.test(stripLeadingWhitespace(sql))
}

function isCommitStatement(sql) {
  return /^COMMIT\b/i.test(stripLeadingWhitespace(sql))
}

function isRollbackStatement(sql) {
  return /^ROLLBACK\b/i.test(stripLeadingWhitespace(sql))
}

function appendReturningIdIfNeeded(sql) {
  if (!/^\s*INSERT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    return sql
  }

  const match = sql.match(/^\s*INSERT\s+INTO\s+("?[\w.]+"?)/i)
  if (!match) {
    return sql
  }

  const rawTable = match[1].replace(/"/g, "")
  const tableName = rawTable.includes(".") ? rawTable.split(".").pop() : rawTable
  if (!TABLES_WITH_ID.has(tableName)) {
    return sql
  }

  return `${sql.trimEnd()} RETURNING id`
}

function replacePlaceholders(sql) {
  let index = 0
  let output = ""
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const prev = i > 0 ? sql[i - 1] : ""

    if (char === "'" && !inDoubleQuote && prev !== "\\") {
      inSingleQuote = !inSingleQuote
      output += char
      continue
    }

    if (char === '"' && !inSingleQuote && prev !== "\\") {
      inDoubleQuote = !inDoubleQuote
      output += char
      continue
    }

    if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      index += 1
      output += `$${index}`
      continue
    }

    output += char
  }

  return output
}

function transformSql(sql, mode) {
  let text = String(sql || "")
  text = text.replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN")
  text = text.replace(/datetime\s*\(\s*'now'\s*\)/gi, "NOW()")

  if (mode === "run") {
    text = appendReturningIdIfNeeded(text)
  }

  return replacePlaceholders(text)
}

function resultToStatementContext(result) {
  return {
    lastID: result.rows?.[0]?.id ?? null,
    changes: Number(result.rowCount || 0),
  }
}

async function runQuery(sql, params = [], mode = "all") {
  const originalSql = String(sql || "")
  const text = transformSql(originalSql, mode)
  const store = contextStorage.getStore()

  const operation = async () => {
    if (isBeginStatement(originalSql)) {
      if (!store) {
        throw new Error("BEGIN requires a database context")
      }
      if (store.client) {
        throw new Error("Transaction already active")
      }
      store.client = await pool.connect()
      return store.client.query("BEGIN")
    }

    const executor = store?.client || pool
    const result = await executor.query(text, params)

    if ((isCommitStatement(originalSql) || isRollbackStatement(originalSql)) && store?.client) {
      store.client.release()
      store.client = null
    }

    return result
  }

  if (!store) {
    return operation()
  }

  const pending = store.queue.then(operation)
  store.queue = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

function normalizeParamsAndCallback(params, callback) {
  if (typeof params === "function") {
    return { params: [], callback: params }
  }
  return { params: Array.isArray(params) ? params : [], callback }
}

function createStatementMethod(mode) {
  return function statementMethod(sql, params = [], callback) {
    const normalized = normalizeParamsAndCallback(params, callback)
    const promise = runQuery(sql, normalized.params, mode).then((result) => {
      if (mode === "get") {
        return result.rows[0] || undefined
      }
      if (mode === "all") {
        return result.rows
      }
      return resultToStatementContext(result)
    })

    if (typeof normalized.callback === "function") {
      promise.then(
        (value) => {
          if (mode === "run") {
            normalized.callback.call(value, null)
            return
          }
          normalized.callback(null, value)
        },
        (err) => {
          if (mode === "run") {
            normalized.callback.call({ lastID: null, changes: 0 }, err)
            return
          }
          normalized.callback(err)
        },
      )
      return undefined
    }

    return promise
  }
}

function serialize(callback) {
  const existing = contextStorage.getStore()
  if (existing) {
    callback()
    return
  }

  contextStorage.run(
    {
      queue: Promise.resolve(),
      client: null,
    },
    callback,
  )
}

async function withTransaction(fn) {
  const client = await pool.connect()
  const context = {
    queue: Promise.resolve(),
    client,
  }

  return contextStorage.run(context, async () => {
    try {
      await client.query("BEGIN")
      const result = await fn()
      await client.query("COMMIT")
      return result
    } catch (err) {
      try {
        await client.query("ROLLBACK")
      } catch {
        // ignore rollback failures
      }
      throw err
    } finally {
      client.release()
      context.client = null
    }
  })
}

function close(callback) {
  const promise = pool.end()
  if (typeof callback === "function") {
    promise.then(
      () => callback(null),
      (err) => callback(err),
    )
    return undefined
  }
  return promise
}

module.exports = {
  query: runQuery,
  get: createStatementMethod("get"),
  all: createStatementMethod("all"),
  run: createStatementMethod("run"),
  serialize,
  withTransaction,
  close,
}
