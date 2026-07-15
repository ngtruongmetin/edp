const express = require("express")
const session = require("express-session")
const path = require("path")
const PgSession = require("connect-pg-simple")(session)
const { loadEnv } = require("./config/env")
const { pool } = require("./config/database")

loadEnv()

const initDb = require("./utils/init")
const { startDutyAutoCreateScheduler } = require("./utils/dutyAutoCreate")

const app = express()
const isProduction = process.env.NODE_ENV === "production"
const usesHttps = (process.env.BACKEND_ORIGIN || "").startsWith("https://")
const isSecureCookie = process.env.SESSION_COOKIE_SECURE === "true" || (isProduction && usesHttps)

if (isProduction) {
  app.set("trust proxy", 1)
}

app.use(express.json({ limit: "25mb" }))
app.use("/assets", express.static(path.join(__dirname, "assets")))

app.use(
  session({
    secret: process.env.SESSION_SECRET || "edp-secret-dang-ngoc-truong",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProduction,
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
      pruneSessionInterval: 900,
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
)

app.use("/api/auth", require("./modules/auth/routes"))
app.use("/api/account", require("./modules/account/routes"))
app.use("/api/rules", require("./modules/rules/routes"))
app.use("/api/classes", require("./modules/classes/routes"))
app.use("/api/schedule", require("./modules/schedule/routes"))
app.use("/api/duty", require("./modules/duty/routes"))
app.use("/api/bonus", require("./modules/bonus/routes"))

app.get("/", (req, res) => {
  res.send("EDP running")
})

const PORT = Number(process.env.PORT) || 3000

async function start() {
  await initDb()
  startDutyAutoCreateScheduler({ repairOnStart: true })

  app.listen(PORT, () => {
    console.log("EDP running")
  })
}

start().catch((err) => {
  console.error("Failed to start server:", err)
  if (err && err.stack) {
    console.error(err.stack)
  }
  process.exit(1)
})
