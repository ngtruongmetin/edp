const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const xlsx = require("xlsx");

const db = new sqlite3.Database("./edp.db");

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const len = Math.floor(Math.random() * 3) + 6; // 6-8 ký tự
  let pass = "";
  for (let i = 0; i < len; i++) {
    pass += chars[Math.floor(Math.random() * chars.length)];
  }
  return pass;
}

async function run() {
  await new Promise((resolve,reject)=>{
    db.run("DELETE FROM accounts",(err)=>{
      if(err) reject(err);
      else resolve();
    });
  });
  const classes = [];

  for (let g of [10,11,12]) {
    for (let i=1;i<=14;i++) {
      classes.push(`${g}A${i}`);
    }
  }

  const excelRows = [];

  for (let i=0;i<classes.length;i++) {

    const classId = i+1;
    const className = classes[i];

    const gvcn = randomPassword();
    const bcs = randomPassword();
    const codo = randomPassword();

    const hashG = await bcrypt.hash(gvcn,10);
    const hashB = await bcrypt.hash(bcs,10);
    const hashC = await bcrypt.hash(codo,10);

    await new Promise((resolve,reject)=>{

      db.run(`
        INSERT INTO accounts
        (class_id,password_gvcn,password_bcs,password_codo,created_at)
        VALUES (?,?,?,?,datetime('now'))
      `,
      [classId,hashG,hashB,hashC],
      (err)=>{
        if(err) reject(err);
        else resolve();
      });

    });

    excelRows.push({
      class: className,
      gvcn_password: gvcn,
      bcs_password: bcs,
      codo_password: codo
    });

    console.log("Created",className);

  }

  const ws = xlsx.utils.json_to_sheet(excelRows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb,ws,"accounts");

  xlsx.writeFile(wb,"accounts_passwords.xlsx");

  console.log("Excel exported: accounts_passwords.xlsx");

  db.close();

}

run();
