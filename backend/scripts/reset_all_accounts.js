const bcrypt = require("bcrypt")
const db = require("../db")
const updateExcel = require("../utils/updateExcel")
const { hashPin } = require("../utils/pinSecurity")
const { loadEnv } = require("../config/env")

loadEnv()

const DEFAULT_PASSWORD = process.env.CLASS_DEFAULT_PASSWORD
const DEFAULT_PIN = process.env.CLASS_DEFAULT_PIN

async function resetAll() {

  if (!DEFAULT_PASSWORD || !DEFAULT_PIN) {
    throw new Error("Missing CLASS_DEFAULT_PASSWORD or CLASS_DEFAULT_PIN")
  }

  console.log("Reset toàn bộ mật khẩu...")

  db.all(
    "SELECT id,name FROM classes",
    [],
    async (err, rows) => {

      if (err) {
        console.error(err)
        process.exit()
      }

      for (const c of rows) {

        const hash_gvcn = await bcrypt.hash(DEFAULT_PASSWORD, 10)
        const hash_bcs = await bcrypt.hash(DEFAULT_PASSWORD, 10)
        const hash_codo = await bcrypt.hash(DEFAULT_PASSWORD, 10)
        const hashed_pin = await hashPin(DEFAULT_PIN)

        await new Promise((resolve, reject) => {

          db.run(`
            UPDATE accounts
            SET
              password_gvcn=?,
              password_bcs=?,
              password_codo=?,
              pin_bcs=?,
              pin_failed_attempts=0,
              pin_locked_until=0,
              password_changed=1,
              password_changed_gvcn=1,
              password_changed_bcs=1,
              password_changed_codo=1
            WHERE class_id=?
          `,
            [hash_gvcn, hash_bcs, hash_codo, hashed_pin, c.id],
            err => {

              if (err) reject(err)
              else resolve()

            })

        })

        updateExcel(c.name, {
          gvcn_password: DEFAULT_PASSWORD,
          bcs_password: DEFAULT_PASSWORD,
          codo_password: DEFAULT_PASSWORD,
          pin_bcs: ""
        })

        console.log("Reset:", c.name)

      }

      console.log("Hoàn tất reset toàn bộ.")

      process.exit()

    }
  )

}

resetAll()
