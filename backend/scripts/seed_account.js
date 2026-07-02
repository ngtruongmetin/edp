const bcrypt = require("bcrypt")
const path = require("path")
const xlsx = require("xlsx")
const db = require("../db")
const { run } = require("../utils/dbp")
const time = require("../utils/time")

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  const len = Math.floor(Math.random() * 3) + 6
  let pass = ""
  for (let i = 0; i < len; i += 1) {
    pass += chars[Math.floor(Math.random() * chars.length)]
  }
  return pass
}

async function main() {
  await run("DELETE FROM accounts")

  const classes = []
  for (const grade of [10, 11, 12]) {
    for (let i = 1; i <= 14; i += 1) {
      classes.push(`${grade}A${i}`)
    }
  }

  const excelRows = []

  for (let i = 0; i < classes.length; i += 1) {
    const classId = i + 1
    const className = classes[i]

    const gvcn = randomPassword()
    const bcs = randomPassword()
    const codo = randomPassword()

    const hashG = await bcrypt.hash(gvcn, 10)
    const hashB = await bcrypt.hash(bcs, 10)
    const hashC = await bcrypt.hash(codo, 10)

    await run(
      `
        INSERT INTO accounts
        (class_id,password_gvcn,password_bcs,password_codo,created_at)
        VALUES (?,?,?,?,?)
      `,
      [classId, hashG, hashB, hashC, time.now()],
    )

    excelRows.push({
      class: className,
      gvcn_password: gvcn,
      bcs_password: bcs,
      codo_password: codo,
    })

    console.log("Created", className)
  }

  const ws = xlsx.utils.json_to_sheet(excelRows)
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, ws, "accounts")
  xlsx.writeFile(wb, path.join(__dirname, "..", "sheets", "accounts_passwords.xlsx"))

  console.log("Excel exported: accounts_passwords.xlsx")
  await db.close()
}

main().catch(async (err) => {
  console.error(err)
  await db.close().catch(() => {})
  process.exit(1)
})
