const { Pool } = require("pg")
const { loadEnv } = require("./env")

loadEnv()

const dbTimezone = process.env.DB_TIMEZONE || "Asia/Ho_Chi_Minh"

function createPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      options: `-c timezone=${dbTimezone}`,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }
  }

  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "edp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    options: `-c timezone=${dbTimezone}`,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  }
}

const pool = new Pool(createPoolConfig())

pool.on("error", (err) => {
  console.error("[database] unexpected pool error:", err.message)
})

module.exports = {
  pool,
}
