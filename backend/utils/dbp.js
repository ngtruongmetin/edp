const db = require("../db")

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err)
      resolve(row)
    })
  })
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err)
      resolve(rows)
    })
  })
}

async function withTransaction(fn) {
  await run("BEGIN IMMEDIATE")
  try {
    const out = await fn()
    await run("COMMIT")
    return out
  } catch (err) {
    try {
      await run("ROLLBACK")
    } catch {
      // ignore rollback failures; prefer the original error
    }
    throw err
  }
}

function isSqliteConstraint(err) {
  return (
    !!err &&
    typeof err === "object" &&
    typeof err.code === "string" &&
    err.code.startsWith("SQLITE_CONSTRAINT")
  )
}

function isForeignKeyError(err) {
  return (
    isSqliteConstraint(err) &&
    (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      /FOREIGN KEY constraint failed/i.test(String(err.message || "")))
  )
}

function isUniqueError(err) {
  return (
    isSqliteConstraint(err) &&
    (err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      /UNIQUE constraint failed/i.test(String(err.message || "")))
  )
}

function isCheckError(err) {
  return (
    isSqliteConstraint(err) &&
    (err.code === "SQLITE_CONSTRAINT_CHECK" ||
      /CHECK constraint failed/i.test(String(err.message || "")))
  )
}

function mapSqliteError(err, fallbackMessage = "Lỗi cơ sở dữ liệu") {
  if (isForeignKeyError(err)) {
    return { status: 409, error: "Dữ liệu liên quan không tồn tại hoặc đã bị xóa" }
  }
  if (isUniqueError(err)) {
    return { status: 409, error: "Dữ liệu đã tồn tại" }
  }
  if (isCheckError(err)) {
    return { status: 400, error: "Dữ liệu không hợp lệ" }
  }
  return { status: 500, error: fallbackMessage }
}

module.exports = {
  run,
  get,
  all,
  withTransaction,
  isForeignKeyError,
  isUniqueError,
  isCheckError,
  mapSqliteError,
}

