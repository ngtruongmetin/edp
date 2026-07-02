const db = require("../db")

function run(sql, params = []) {
  return db.run(sql, params)
}

function get(sql, params = []) {
  return db.get(sql, params)
}

function all(sql, params = []) {
  return db.all(sql, params)
}

function withTransaction(fn) {
  return db.withTransaction(fn)
}

function isConstraintError(err) {
  return !!err && typeof err.code === "string" && err.code.startsWith("23")
}

function isForeignKeyError(err) {
  return isConstraintError(err) && err.code === "23503"
}

function isUniqueError(err) {
  return isConstraintError(err) && err.code === "23505"
}

function isCheckError(err) {
  return isConstraintError(err) && err.code === "23514"
}

function mapDatabaseError(err, fallbackMessage = "Lỗi cơ sở dữ liệu") {
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
  mapDatabaseError,
}
