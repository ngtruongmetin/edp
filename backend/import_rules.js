const xlsx = require("xlsx");
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./edp.db");

const workbook = xlsx.readFile("./ruleset2526.xlsx");
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet);

async function run(){

  for(const r of rows){

    const category = r.category?.trim()
    const name = r.name?.trim()
    const score = Number(r.score_delta)

    await new Promise((resolve,reject)=>{

      db.run(`
        INSERT INTO rules
        (category,name,score_delta)
        VALUES (?,?,?)
      `,
      [category,name,score],
      (err)=>{
        if(err) reject(err)
        else resolve()
      })

    })

    console.log("Inserted:",name)

  }

  console.log("IMPORT DONE")

  db.close()

}

run()
