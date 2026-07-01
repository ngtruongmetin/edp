const VN_OFFSET = 7 * 60 * 60 * 1000



/*
current time GMT+7
format: YYYY-MM-DD HH:mm:ss
*/
function now(){

  const d = new Date(Date.now() + VN_OFFSET)

  return d.toISOString()
    .slice(0,19)
    .replace("T"," ")

}



/*
date only
YYYY-MM-DD
*/
function today(){

  const d = new Date(Date.now() + VN_OFFSET)

  return d.toISOString().slice(0,10)

}



/*
format datetime for frontend

input:
2026-03-06 00:00:00

output:
06/03/2026
or
12:30:00 06/03/2026
*/
function format(dateStr){

  if(!dateStr) return ""

  const [date,time] = dateStr.split(" ")

  const [y,m,d] = date.split("-")

  if(!time || time==="00:00:00"){
    return `${d}/${m}/${y}`
  }

  return `${time} ${d}/${m}/${y}`

}



/*
parse YYYY-MM-DD
*/
function parseDate(dateStr){

  const [y,m,d] = dateStr.split("-")

  return new Date(y,m-1,d)

}



/*
add days
*/
function addDays(dateStr,days){

  const d = parseDate(dateStr)

  d.setDate(d.getDate()+days)

  return d.toISOString().slice(0,10)

}



/*
calculate next week

input:
2026-03-06

output:
2026-03-13
*/
function nextWeek(dateStr){

  return addDays(dateStr,7)

}



/*
get week range

Friday → Thursday
*/
function weekRange(startDate){

  const start = startDate
  const end = addDays(startDate,6)

  return {
    start,
    end
  }

}



module.exports = {

  now,
  today,
  format,
  parseDate,
  addDays,
  nextWeek,
  weekRange

}
