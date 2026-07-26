const bcrypt = require("bcrypt")
const fs = require("fs")
const path = require("path")
const xlsx = require("xlsx")
const db = require("../db")
const time = require("../utils/time")
const { hashPin } = require("../utils/pinSecurity")
const { loadEnv } = require("../config/env")

loadEnv()

const DEFAULT_GVCN_BAN_CAN_SU_PASSWORD = process.env.SEED_DEFAULT_PASSWORD
const DEFAULT_CODO_PASSWORD = process.env.SEED_DEFAULT_PASSWORD
const DEFAULT_PIN = process.env.SEED_DEFAULT_PIN
const workbookPath = path.join(__dirname, "..", "sheets", "accounts_passwords.xlsx")

async function main() {
  if (!DEFAULT_GVCN_BAN_CAN_SU_PASSWORD || !DEFAULT_CODO_PASSWORD || !DEFAULT_PIN) {
    throw new Error("Missing SEED_DEFAULT_PASSWORD or SEED_DEFAULT_PIN")
  }

  const classesResult = await db.query(
    `
      SELECT id, name
      FROM classes
      ORDER BY id ASC
    `,
  )
  const classes = classesResult.rows || []

  const existingAccountsResult = await db.query(
    `
      SELECT a.*, c.name AS class_name
      FROM accounts a
      JOIN classes c
        ON c.id = a.class_id
    `,
  )
  const existingAccounts = new Map(
    (existingAccountsResult.rows || []).map((row) => [Number(row.class_id), row]),
  )

  const workbookRows = new Map()
  if (fs.existsSync(workbookPath)) {
    const workbook = xlsx.readFile(workbookPath)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = sheet ? xlsx.utils.sheet_to_json(sheet) : []
    rows.forEach((row) => {
      const className = String(row.class || "").trim().toUpperCase()
      if (className) {
        workbookRows.set(className, row)
      }
    })
  }

  const excelRows = []

  for (const cls of classes) {
    const classId = Number(cls.id)
    const className = String(cls.name || "").trim().toUpperCase()
    const account = existingAccounts.get(classId)
    const workbookRow = workbookRows.get(className)

    const gvcnPassword = DEFAULT_GVCN_BAN_CAN_SU_PASSWORD
    const banCanSuPassword = DEFAULT_GVCN_BAN_CAN_SU_PASSWORD
    const codoPassword = DEFAULT_CODO_PASSWORD
    const pin = DEFAULT_PIN

    if (!account) {
      const hashG = await bcrypt.hash(gvcnPassword, 10)
      const hashBanCanSu = await bcrypt.hash(banCanSuPassword, 10)
      const hashC = await bcrypt.hash(codoPassword, 10)
      const hashPinValue = await hashPin(pin)

      await db.query(
        `
          INSERT INTO accounts
          (class_id, password_gvcn, password_ban_can_su, password_codo, pin_ban_can_su, password_changed, password_changed_gvcn, password_changed_ban_can_su, password_changed_codo, created_at)
          VALUES ($1, $2, $3, $4, $5, 1, 1, 1, 1, $6)
        `,
        [classId, hashG, hashBanCanSu, hashC, hashPinValue, time.now()],
      )
      console.log("Created", className)
    } else {
      const hashG = await bcrypt.hash(gvcnPassword, 10)
      const hashBanCanSu = await bcrypt.hash(banCanSuPassword, 10)
      const hashC = await bcrypt.hash(codoPassword, 10)
      const hashPinValue = await hashPin(pin)
      await db.query(
        `
          UPDATE accounts
          SET pin_ban_can_su = $1
          , pin_failed_attempts = 0
          , pin_locked_until = 0
          , pin_version = COALESCE(pin_version, 1) + 1
          , password_gvcn = $3
          , password_ban_can_su = $4
          , password_codo = $5
          , password_changed = 1
          , password_changed_gvcn = 1
          , password_changed_ban_can_su = 1
          , password_changed_codo = 1
          WHERE class_id = $2
        `,
        [hashPinValue, classId, hashG, hashBanCanSu, hashC],
      )
    }

    excelRows.push({
      class: className,
      gvcn_password: gvcnPassword,
      ban_can_su_password: banCanSuPassword,
      codo_password: codoPassword,
      pin_ban_can_su: "",
    })
  }

  excelRows.sort((a, b) => {
    const gradeA = parseInt(String(a.class || "").slice(0, 2), 10) || 0
    const gradeB = parseInt(String(b.class || "").slice(0, 2), 10) || 0
    if (gradeA !== gradeB) return gradeA - gradeB
    const numA = parseInt(String(a.class || "").split("A")[1], 10) || 0
    const numB = parseInt(String(b.class || "").split("A")[1], 10) || 0
    return numA - numB
  })

  const ws = xlsx.utils.json_to_sheet(excelRows, {
    header: ["class", "gvcn_password", "ban_can_su_password", "codo_password", "pin_ban_can_su"],
  })
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, ws, "accounts")
  xlsx.writeFile(wb, workbookPath)

  console.log("Excel exported: accounts_passwords.xlsx")
  await db.close()
}

main().catch(async (err) => {
  console.error(err)
  await db.close().catch(() => {})
  process.exit(1)
})
