const XLSX = require("xlsx")
const fs = require("fs")
const path = require("path")

const filePath = path.join(__dirname, "../sheets/accounts_passwords.xlsx")
const SHEET_NAME = "accounts"

function updateExcel(className,data){

  let workbook
  let rows = []

  if(fs.existsSync(filePath)){

    workbook = XLSX.readFile(filePath)

    const sheet = workbook.Sheets[SHEET_NAME]

    if(sheet){
      rows = XLSX.utils.sheet_to_json(sheet)
    }

  }else{

    workbook = XLSX.utils.book_new()

  }



  const index = rows.findIndex(r=>r.class===className)



  if(data.deleted){

    if(index!==-1){
      rows.splice(index,1)
    }

  }else{

    if(index!==-1){

      rows[index] = {
        ...rows[index],
        ...data
      }

    }else{

      rows.push({
        class:className,
        ...data
      })

    }

  }



  rows = rows.map(r=>({

    class:r.class || "",
    gvcn_password:r.gvcn_password || "",
    bcs_password:r.bcs_password || "",
    codo_password:r.codo_password || "",
    pin_bcs:""

  }))



  rows.sort((a,b)=>{

    const g1 = parseInt(a.class)
    const g2 = parseInt(b.class)

    if(g1!==g2) return g1-g2

    const n1 = parseInt(a.class.split("A")[1])
    const n2 = parseInt(b.class.split("A")[1])

    return n1-n2

  })



  const sheet = XLSX.utils.json_to_sheet(rows,{
    header:[
      "class",
      "gvcn_password",
      "bcs_password",
      "codo_password",
      "pin_bcs"
    ]
  })



  workbook.Sheets[SHEET_NAME] = sheet



  if(!workbook.SheetNames.includes(SHEET_NAME)){
    workbook.SheetNames.push(SHEET_NAME)
  }



  XLSX.writeFile(workbook,filePath)

}



module.exports = updateExcel
