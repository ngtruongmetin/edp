import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"
import toast from "react-hot-toast"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id:number
  week_number:number
  start_date:string
  end_date:string
}

type Assignment = {
  red_class:string
  duty_class:string
}

export default function AdminSchedule(){
  usePageTitle("EDP | Lịch trực")

  const [weeks,setWeeks] = useState<Week[]>([])
  const [weekId,setWeekId] = useState<number | null>(null)
  const [editStartDate,setEditStartDate] = useState("")
  const [editEndDate,setEditEndDate] = useState("")

  const [classes,setClasses] = useState<string[]>([])
  const [assignments,setAssignments] = useState<Record<string,string>>({})
  const [prevAssignments,setPrevAssignments] = useState<Record<string,string>>({})

  const [showCreateModal,setShowCreateModal] = useState(false)

  const [newWeek,setNewWeek] = useState({
    week_number:"",
    start_date:"",
    end_date:""
  })

  function formatDate(date:string){
    if(!date) return ""
    const [y,m,d] = date.split("-")
    return `${d}/${m}/${y}`
  }

  function toInputDate(date:string){
    if(!date) return ""
    const [d,m,y] = date.split("/")
    return `${y}-${m}-${d}`
  }

  function fromInputDate(date:string){
    if(!date) return ""
    const [y,m,d] = date.split("-")
    return `${d}/${m}/${y}`
  }

  function autoEndDate(start:string){
    const date = new Date(start)
    date.setDate(date.getDate()+6)

    const y = date.getFullYear()
    const m = String(date.getMonth()+1).padStart(2,"0")
    const d = String(date.getDate()).padStart(2,"0")

    return `${d}/${m}/${y}`
  }

  useEffect(()=>{
    loadWeeks()
    loadClasses()
  },[])

  async function loadWeeks(){

    const res = await api.get("/schedule/admin")

    setWeeks(res.data)

    if(res.data.length>0){
      loadWeek(res.data[0].id)
    }

  }

  async function loadClasses(){

    const res = await api.get("/classes/admin")

    const list = res.data.map((c:any)=>c.name)

    list.sort((a:string,b:string)=>{

      const gA = parseInt(a)
      const gB = parseInt(b)

      if(gA !== gB) return gA-gB

      const nA = parseInt(a.split("A")[1])
      const nB = parseInt(b.split("A")[1])

      return nA-nB

    })

    setClasses(list)

  }

  async function loadWeek(id:number){

    const res = await api.get(`/schedule/week/${id}`)

    const map:Record<string,string> = {}

    res.data.assignments.forEach((a:Assignment)=>{
      map[a.red_class] = a.duty_class
    })

    setAssignments(map)
    setWeekId(id)
    setEditStartDate(res.data.week?.start_date || "")
    setEditEndDate(res.data.week?.end_date || "")

    const index = weeks.findIndex(w=>w.id===id)

    if(index !== -1 && index < weeks.length-1){

      const prevId = weeks[index+1].id

      const prev = await api.get(`/schedule/week/${prevId}`)

      const p:Record<string,string> = {}

      prev.data.assignments.forEach((a:Assignment)=>{
        p[a.red_class] = a.duty_class
      })

      setPrevAssignments(p)

    }

  }

  async function updateWeekDates(){
    if(!weekId) return

    const current = weeks.find(w=>w.id===weekId)
    if(!current) return
    if(!editStartDate || !editEndDate){
      toast.error("Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc")
      return
    }
    if(editStartDate > editEndDate){
      toast.error("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc")
      return
    }

    try{
      await api.post("/schedule/update-week",{
        week_id:weekId,
        start_date: editStartDate,
        end_date: editEndDate
      })

      setWeeks(weeks.map(w=> w.id===weekId ? { ...w, start_date: editStartDate, end_date: editEndDate } : w))
      toast.success("Đã cập nhật tuần")
    }catch(err:any){
      const msg = err?.response?.data?.error || "Không thể cập nhật tuần"
      toast.error(msg)
    }
  }

  const grade10 = classes.filter(c=>c.startsWith("10"))
  const grade11 = classes.filter(c=>c.startsWith("11"))
  const grade12 = classes.filter(c=>c.startsWith("12"))

  function autoAssign(targetGrade:string,dutyGrade:string){

    let redList:string[]=[]
    let dutyList:string[]=[]

    if(targetGrade==="10") redList = grade10
    if(targetGrade==="11") redList = grade11
    if(targetGrade==="12") redList = grade12

    if(dutyGrade==="10") dutyList = grade10
    if(dutyGrade==="11") dutyList = grade11
    if(dutyGrade==="12") dutyList = grade12

    const used = Object.values(assignments)

    const available = dutyList.filter(c=>!used.includes(c))

    const map = {...assignments}

    redList.forEach(red=>{

      let choices = available.filter(c=>c!==red)

      const prev = prevAssignments[red]

      if(prev){
        choices = choices.filter(c=>c!==prev)
      }

      if(choices.length===0){
        choices = dutyList.filter(c=>!used.includes(c) && c!==red)
      }

      if(choices.length===0) return

      const duty = choices[Math.floor(Math.random()*choices.length)]

      map[red] = duty

      const index = available.indexOf(duty)

      if(index>-1){
        available.splice(index,1)
      }

    })

    setAssignments(map)

  }
  function resetAssign(grade:string){

    let list:string[] = []

    if(grade==="10") list = grade10
    if(grade==="11") list = grade11
    if(grade==="12") list = grade12

    const map = {...assignments}

    list.forEach(c=>{
      map[c] = ""
    })

    setAssignments(map)

  }
  function update(red:string,value:string){

    setAssignments({
      ...assignments,
      [red]:value
    })

  }

  async function save(){

    if(!weekId) return

    const data = Object.keys(assignments).map(red=>({
      red_class:red,
      duty_class:assignments[red]
    }))

    await api.post("/schedule/save",{
      week_id:weekId,
      assignments:data
    })

    alert("Đã lưu")

  }

  async function createWeek(){

    const {week_number,start_date,end_date} = newWeek

    if(!week_number || !start_date || !end_date){
      alert("Nhập đầy đủ thông tin")
      return
    }

    const start = new Date(toInputDate(start_date))
    const end = new Date(toInputDate(end_date))

    if(end < start){
      alert("Ngày kết thúc phải sau ngày bắt đầu")
      return
    }

    const res = await api.post("/schedule/create-week",{
      week_number,
      start_date,
      end_date
    })

    setShowCreateModal(false)

    setNewWeek({
      week_number:"",
      start_date:"",
      end_date:""
    })

    await loadWeeks()

    loadWeek(res.data.week_id)

  }

  async function deleteWeek(){

    if(!weekId) return

    if(!confirm("Xóa tuần này?")) return

    await api.delete(`/schedule/week/${weekId}`)

    await loadWeeks()

  }

  const usedClasses = Object.values(assignments)

  function renderRow(list:string[]){

    return(

      <tr>

        <td className="p-4 border-b bg-red-100 font-medium">
          Lớp trực
        </td>

        {list.map(c=>{

          const value = assignments[c] || ""

          return(

            <td key={c} className="p-2 border-b">

              <select
                value={value}
                onChange={(e)=>update(c,e.target.value)}
                className="border rounded px-2 py-1 min-w-[140px]"
              >

                <option value="">--</option>

                {classes
                  .filter(x=>x!==c && (!usedClasses.includes(x) || x===value))
                  .map(x=>(
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}

              </select>

            </td>

          )

        })}

      </tr>

    )

  }

  function renderBlock(title:string,list:string[],grade:string){

    return(

      <div className="bg-white border shadow-sm overflow-x-auto">

      <div className="px-4 py-3 border-b bg-gray-100 font-semibold flex items-center gap-2">

        <span>{title}</span>

        <button
          onClick={()=>{
            const g = prompt(`${title} trực khối nào? (10 / 11 / 12)`)
            if(!g) return
            autoAssign(grade,g)
          }}
          className="ml-auto bg-blue-500 text-white text-sm px-3 py-1 rounded hover:bg-blue-600"
        >
          Phân công trực
        </button>

        <button
          onClick={()=>resetAssign(grade)}
          className="bg-gray-500 text-white text-sm px-3 py-1 rounded hover:bg-gray-600"
        >
          Reset
        </button>

      </div>

        <table className="w-max text-sm">

          <thead>

            <tr>

              <th className="p-4 border-b text-left sticky left-0 bg-white">
                Cờ đỏ
              </th>

              {list.map(c=>(
                <th key={c} className="p-4 border-b text-center">
                  {c}
                </th>
              ))}

            </tr>

          </thead>

          <tbody>

            {renderRow(list)}

          </tbody>

        </table>

      </div>

    )

  }

  return(

    <div className="min-h-screen flex flex-col bg-gray-50">

      <Navbar/>

      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-6">

        <div className="text-sm text-gray-500 flex items-center gap-2">

          <Link to="/admin/dashboard">
            Dashboard
          </Link>

          <span>/</span>

          <span className="font-medium text-gray-700">
            Quản lý lịch trực
          </span>

        </div>

        <div className="flex items-center">

          <h1 className="text-3xl font-semibold text-[#2e77df]">
            Lịch trực cờ đỏ
          </h1>

          <button
            onClick={()=>setShowCreateModal(true)}
            className="ml-auto bg-[#2e77df] text-white px-5 py-2 rounded"
          >
            + Tạo tuần
          </button>

        </div>

        <div className="bg-white border p-4 rounded shadow-sm flex gap-4 items-center">

          <span>Tuần:</span>

          <select
            value={weekId || ""}
            onChange={(e)=>loadWeek(Number(e.target.value))}
            className="border px-3 py-2"
          >

            {weeks.map(w=>(
              <option key={w.id} value={w.id}>
                Tuần {w.week_number} ({formatDate(w.start_date)} → {formatDate(w.end_date)})
              </option>
            ))}

          </select>

          <button
            onClick={save}
            className="ml-auto bg-green-500 text-white px-4 py-2 rounded"
          >
            Lưu
          </button>

          <button
            onClick={deleteWeek}
            className="bg-red-500 text-white px-4 py-2 rounded"
          >
            Xóa tuần
          </button>

        </div>

        <div className="bg-white border p-4 rounded shadow-sm flex gap-4 items-center">
          <span>Ngày bắt đầu:</span>
          <input
            type="date"
            value={editStartDate}
            onChange={(e)=>setEditStartDate(e.target.value)}
            className="border px-3 py-2"
          />

          <span>Ngày kết thúc:</span>
          <input
            type="date"
            value={editEndDate}
            onChange={(e)=>setEditEndDate(e.target.value)}
            className="border px-3 py-2"
          />
          <button
            onClick={updateWeekDates}
            className="ml-auto bg-[#2e77df] text-white px-4 py-2 rounded"
          >
            Cập nhật tuần
          </button>
        </div>

        <div className="space-y-6">

          {renderBlock("Khối 10",grade10,"10")}
          {renderBlock("Khối 11",grade11,"11")}
          {renderBlock("Khối 12",grade12,"12")}

        </div>

      </div>

      {showCreateModal && (

      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">

        <div className="bg-white w-[420px] rounded-lg shadow-lg p-6 space-y-4">

          <h2 className="text-xl font-semibold text-[#2e77df]">
            Tạo tuần mới
          </h2>

          <div>
            <label className="text-sm">Tuần số</label>

            <input
              type="number"
              value={newWeek.week_number}
              onChange={(e)=>setNewWeek({...newWeek,week_number:e.target.value})}
              className="border rounded px-3 py-2 w-full"
            />
          </div>

          <div>
            <label className="text-sm">Ngày bắt đầu</label>

            <input
              type="date"
              onChange={(e)=>{

                const start = fromInputDate(e.target.value)

                setNewWeek({
                  ...newWeek,
                  start_date:start,
                  end_date:autoEndDate(e.target.value)
                })

              }}
              className="border rounded px-3 py-2 w-full"
            />
          </div>

          <div>
            <label className="text-sm">Ngày kết thúc</label>

            <input
              type="date"
              value={toInputDate(newWeek.end_date)}
              onChange={(e)=>setNewWeek({
                ...newWeek,
                end_date:fromInputDate(e.target.value)
              })}
              className="border rounded px-3 py-2 w-full"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3">

            <button
              onClick={()=>setShowCreateModal(false)}
              className="px-4 py-2 border rounded"
            >
              Hủy
            </button>

            <button
              onClick={createWeek}
              className="px-4 py-2 bg-[#2e77df] text-white rounded"
            >
              Tạo tuần
            </button>

          </div>

        </div>

      </div>

      )}

      <Footer/>

    </div>

  )

}
