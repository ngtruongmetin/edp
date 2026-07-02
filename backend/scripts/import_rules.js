const path = require("path")
const xlsx = require("xlsx")
const db = require("../db")
const { run } = require("../utils/dbp")

const workbook = xlsx.readFile(path.join(__dirname, "..", "sheets", "ruleset2526.xlsx"))
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet)

async function main() {
  for (const row of rows) {
    const category = row.category?.trim()
    const name = row.name?.trim()
    const score = Number(row.score_delta)

    await run(
      `
        INSERT INTO rules
        (category,name,score_delta)
        VALUES (?,?,?)
      `,
      [category, name, score],
    )

    console.log("Inserted:", name)
  }

  console.log("IMPORT DONE")
  await db.close()
}

main().catch(async (err) => {
  console.error(err)
  await db.close().catch(() => {})
  process.exit(1)
})
