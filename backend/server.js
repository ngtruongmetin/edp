const express = require("express")
const session = require("express-session")
const path = require("path")
const { loadEnv } = require("./config/env")

loadEnv()

const initDb = require("./utils/init")
const { startDutyAutoCreateScheduler } = require("./utils/dutyAutoCreate")

const app = express()

app.use(express.json({ limit: "25mb" }))
app.use("/assets", express.static(path.join(__dirname, "assets")))

app.use(
  session({
    secret: process.env.SESSION_SECRET || "edp-secret-dang-ngoc-truong",
    resave: false,
    saveUninitialized: false,
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
  console.error("Failed to start server:", err.message)
  process.exit(1)
})
