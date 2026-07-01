const bcrypt = require("bcrypt")
const db = require("./db")
const updateExcel = require("./utils/updateExcel")

async function resetAll(){

  console.log("Reset toàn bộ mật khẩu...")

  db.all(
    "SELECT id,name FROM classes",
    [],
    async (err,rows)=>{

      if(err){
        console.error(err)
        process.exit()
      }

      for(const c of rows){

        const gvcnPass = Math.random().toString(36).slice(-6)
        const bcsPass = Math.random().toString(36).slice(-6)
        const codoPass = Math.random().toString(36).slice(-6)

        const pin = Math.floor(100000 + Math.random()*900000)

        const hash_gvcn = await bcrypt.hash(gvcnPass,10)
        const hash_bcs = await bcrypt.hash(bcsPass,10)
        const hash_codo = await bcrypt.hash(codoPass,10)

        await new Promise((resolve,reject)=>{

          db.run(`
            UPDATE accounts
            SET
              password_gvcn=?,
              password_bcs=?,
              password_codo=?,
              pin_bcs=?
            WHERE class_id=?
          `,
          [hash_gvcn,hash_bcs,hash_codo,pin,c.id],
          err=>{

            if(err) reject(err)
            else resolve()

          })

        })

        updateExcel(c.name,{
          gvcn_password:gvcnPass,
          bcs_password:bcsPass,
          codo_password:codoPass,
          pin_bcs:pin
        })

        console.log("Reset:",c.name)

      }

      console.log("Hoàn tất reset toàn bộ.")

      process.exit()

    }
  )

}

resetAll()