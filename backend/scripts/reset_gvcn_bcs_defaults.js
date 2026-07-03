const bcrypt = require("bcrypt")
const db = require("../db")
const updateExcel = require("../utils/updateExcel")
const { loadEnv } = require("../config/env")

loadEnv()

const DEFAULT_PASSWORD = process.env.CLASS_DEFAULT_PASSWORD
const DEFAULT_PIN = process.env.CLASS_DEFAULT_PIN

async function resetGvcnBcsDefaults() {
  if (!DEFAULT_PASSWORD || !DEFAULT_PIN) {
    throw new Error("Missing CLASS_DEFAULT_PASSWORD or CLASS_DEFAULT_PIN")
  }

  console.log("Reset mật khẩu GVCN + Ban cán sự về mặc định...")

  db.all("SELECT id, name FROM classes", [], async (err, rows) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

    for (const c of rows) {
      await new Promise((resolve, reject) => {
        db.run(
          `
            UPDATE accounts
            SET
              password_gvcn=?,
              password_bcs=?,
              password_codo=?,
              pin_bcs=?,
              password_changed=1,
              password_changed_gvcn=1,
              password_changed_bcs=1,
              password_changed_codo=1
            WHERE class_id=?
          `,
          [hash, hash, hash, DEFAULT_PIN, c.id],
          (e) => (e ? reject(e) : resolve()),
        )
      })

      updateExcel(c.name, {
        gvcn_password: DEFAULT_PASSWORD,
        bcs_password: DEFAULT_PASSWORD,
        codo_password: DEFAULT_PASSWORD,
        pin_bcs: DEFAULT_PIN,
      })

      console.log("Reset:", c.name)
    }

    console.log("Hoàn tất reset GVCN + Ban cán sự.")
    process.exit(0)
  })
}

resetGvcnBcsDefaults()
