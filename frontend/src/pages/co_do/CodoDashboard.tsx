import { useEffect, useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import toast from "react-hot-toast"
import { formatDutyStatus } from "../../utils/dutyFormat"
import { usePageTitle } from "../../utils/usePageTitle"

type Assignment = {
  red_class:string
  duty_class:string
}

type Week = {
  id?:number
  week_number:number
  start_date:string
  end_date:string
}

type ScheduleRes = {
  week:Week
  assignments:Assignment[]
}

export default function CoDoDashboard(){
  usePageTitle("EDP | Cờ đỏ")

  const context = useOutletContext<any>()
  const setShowChangePassword = context?.setShowChangePassword as
    | ((open: boolean) => void)
    | undefined

  const [time,setTime] = useState("")
  const [date,setDate] = useState("")

  const [className,setClassName] = useState("")
  const [dutyClassCurrent,setDutyClassCurrent] = useState<string | null>(null)
  const [dutyClassView,setDutyClassView] = useState<string | null>(null)

  const [weeks,setWeeks] = useState<Week[]>([])
  const [weekId,setWeekId] = useState<number | null>(null)
  const [currentWeekId,setCurrentWeekId] = useState<number | null>(null)
  const [prevWeekId,setPrevWeekId] = useState<number | null>(null)
  const [week,setWeek] = useState<Week | null>(null)
  const [myWeekSessions,setMyWeekSessions] = useState<any[]>([])
  const [detailId,setDetailId] = useState<number | null>(null)
  const [detail,setDetail] = useState<any>(null)

  const navigate = useNavigate()

  useEffect(()=>{

    loadUser()

    const timer = setInterval(()=>{

      const now = new Date()

      const h = String(now.getHours()).padStart(2,"0")
      const m = String(now.getMinutes()).padStart(2,"0")
      const s = String(now.getSeconds()).padStart(2,"0")

      const d = String(now.getDate()).padStart(2,"0")
      const mo = String(now.getMonth()+1).padStart(2,"0")
      const y = now.getFullYear()

      setTime(`${h}:${m}:${s}`)
      setDate(`${d}/${mo}/${y}`)

    },1000)

    return ()=>clearInterval(timer)

  },[])

  useEffect(()=>{
    if(className){
      loadSchedule()
      loadWeeks()
    }
  },[className])

  useEffect(()=>{
    if(weekId){
      loadMyWeek(weekId)
    }
  },[weekId])

  async function loadUser(){

    try{

      const res = await api.get("/auth/me")

      setClassName(res.data.class_name)

    }catch(err){

      console.error(err)

    }

  }


  async function loadSchedule(){

    try{

      const res = await api.get("/schedule")

      const data:ScheduleRes = res.data

      setWeek(data.week)

      const row = data.assignments.find(
        a => a.red_class === className
      )

      if(row){
        setDutyClassCurrent(row.duty_class)
      }else{
        setDutyClassCurrent(null)
      }

    }catch(err){

      console.error(err)

    }

  }

  async function loadWeeks(){
    try{
      const res = await api.get("/duty/co_do/weeks")
      const list:Week[] = res.data.weeks || []
      setWeeks(list)

      const today = new Date()
      const todayIso = [
        today.getFullYear(),
        String(today.getMonth()+1).padStart(2,"0"),
        String(today.getDate()).padStart(2,"0")
      ].join("-")

      const currentIndex = list.findIndex(w => w.start_date <= todayIso && todayIso <= w.end_date)
      const current = currentIndex >= 0 ? list[currentIndex] : null
      const prev = currentIndex >= 0 ? list[currentIndex + 1] : (list[1] || null)

      setCurrentWeekId(current?.id ?? null)
      setPrevWeekId(prev?.id ?? null)
      setWeekId(current?.id ?? list[0]?.id ?? null)
    }catch(err){
      console.error(err)
    }
  }

  async function loadMyWeek(id:number){
    try{
      const res = await api.get(`/duty/co_do/week/${id}`)
      setWeek(res.data.week || null)
      setMyWeekSessions(res.data.sessions || [])

      setDutyClassView(res.data.duty_class || null)
    }catch(err){
      console.error(err)
    }
  }

  async function startDutyNow(){

    try{
      await api.post("/duty/create",{})
      navigate("/co_do/duty")
    }catch(err:any){
      console.error(err)
      const msg = err?.response?.data?.error || "Không thể bắt đầu ca trực"
      toast.error(msg)
    }

  }

  function weekday(dateStr:string){
    if(!dateStr) return ""
    const [y,m,d] = dateStr.split("-").map(Number)
    const dt = new Date(y, (m||1)-1, d||1)
    return dt.toLocaleDateString("vi-VN",{ weekday:"short" })
  }

  function weekLabelById(id:number | null){
    if(!id) return "Tuần ?"
    const found = weeks.find(w=>w.id===id)
    return found?.week_number ? `Tuần ${found.week_number}` : "Tuần ?"
  }

  async function openDetail(id:number){
    setDetailId(id)
    setDetail(null)
    try{
      const res = await api.get(`/duty/my/session/${id}`)
      setDetail(res.data)
    }catch(err){
      console.error(err)
      toast.error("Không tải được phiếu")
    }
  }

  function editSession(id:number){
    navigate(`/co_do/duty/${id}`)
  }

  function formatDate(date:string){

    if(!date) return ""

    const [y,m,d] = date.split("-")

    return `${d}/${m}/${y}`

  }

  return(

    <div className="min-h-screen flex flex-col bg-slate-50">

      <Navbar/>

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-5 pb-10 space-y-5">

        {/* HERO */}

        <div className="rounded-3xl bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-lg">

          <div className="px-6 pt-6 pb-5">

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm opacity-90">
                Xin chào
              </div>
              <button
                onClick={() => setShowChangePassword?.(true)}
                className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold hover:bg-white/30 transition"
              >
                Cài đặt
              </button>
            </div>

            <div className="mt-1 text-2xl font-semibold tracking-tight">
              Cờ đỏ lớp {className || "--"}
            </div>

            <div className="mt-4 flex items-baseline justify-between">

              <div className="text-3xl font-semibold tracking-tight">
                {time}
              </div>

              <div className="text-sm opacity-90">
                {date}
              </div>

            </div>

          </div>

        </div>


        {/* Week info */}

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-sm text-gray-600">Chọn tuần</div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => currentWeekId && setWeekId(currentWeekId)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold shadow-sm ${
                weekId === currentWeekId
                  ? "bg-[#2e77df] text-white"
                  : "bg-white text-gray-900 ring-1 ring-blue-50 hover:bg-gray-50"
              }`}
            >
              {weekLabelById(currentWeekId)}
            </button>
            {prevWeekId && (
              <button
                onClick={() => setWeekId(prevWeekId)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold shadow-sm ${
                  weekId === prevWeekId
                    ? "bg-[#2e77df] text-white"
                    : "bg-white text-gray-900 ring-1 ring-blue-50 hover:bg-gray-50"
                }`}
              >
                {weekLabelById(prevWeekId)}
              </button>
            )}
          </div>
          {week ? (
            <>
              <div className="mt-3 text-xl font-semibold text-[#2e77df]">
                Tuần {week.week_number}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                {formatDate(week.start_date)} - {formatDate(week.end_date)}
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Chưa có dữ liệu tuần.</div>
          )}
        </div>

        {/* Duty */}

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">

          <div className="text-sm text-gray-600">
            Lớp trực
          </div>

          <div className="mt-1 text-3xl font-semibold text-[#2e77df]">
            {dutyClassView ? dutyClassView : "--"}
          </div>

          {!dutyClassView && (
            <div className="mt-2 text-xs text-gray-500">
              Chưa có lịch trực cho lớp bạn trong tuần đang xem.
            </div>
          )}

        </div>

        {/* Actions */}

        <div className="space-y-3">

          <button
            onClick={startDutyNow}
            disabled={!dutyClassCurrent}
            className="block w-full rounded-2xl bg-[#2e77df] py-4 text-center text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#1f5fc0] disabled:opacity-50"
          >
            Bắt đầu trực
          </button>

        </div>

        {/* My week sessions */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-gray-900">
              Phiếu trực trong tuần
            </div>
            <div className="ml-auto text-xs text-gray-500">
              {myWeekSessions.length} phiếu
            </div>
          </div>

          {myWeekSessions.length===0 ? (
            <div className="mt-3 text-sm text-gray-600">
              Chưa có phiếu trực trong tuần đang xem.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {myWeekSessions.map((s:any)=>(
                <button
                  key={s.id}
                  onClick={()=>openDetail(s.id)}
                  className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-left shadow-sm hover:bg-slate-50 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-gray-900">
                        {weekday(s.date)} {formatDate(s.date)}: trực {s.duty_class}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        Tổng điểm:{" "}
                        <span
                          className={`font-semibold ${
                            Number(s.total_score) >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {Number(s.total_score) > 0
                            ? `+${s.total_score}`
                            : String(s.total_score)}
                        </span>{" "}
                        | Vi phạm:{" "}
                        <span className="font-semibold text-gray-700">
                          {Number(s.violation_score) > 0
                            ? `+${s.violation_score}`
                            : String(s.violation_score)}
                        </span>{" "}
                        | Điểm cộng:{" "}
                        <span className="font-semibold text-[#2e77df]">
                          +{s.bonus_points || 0}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {s.status==="signed" ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                          Đã ký
                        </span>
                      ):(
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                          Nháp
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {detailId!=null && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={()=>{
                setDetailId(null)
                setDetail(null)
              }}
            />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold text-gray-900">
                  Phiếu trực
                </div>
                <button
                  className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                  onClick={()=>{
                    setDetailId(null)
                    setDetail(null)
                  }}
                >
                  Đóng
                </button>
              </div>

              {!detail ? (
                <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
              ) : (
                <div className="mt-3 max-h-[70vh] overflow-y-auto space-y-4 pb-2">
                  {(() => {
                    const vio = (detail.violations || []).reduce(
                      (sum: number, v: any) => sum + Number(v.score_delta || 0) * Number(v.quantity || 0),
                      0,
                    )
                    const bonus = Number(detail.session?.bonus_points || 0)
                    const total = vio + bonus
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-[11px] text-gray-500">Vi phạm</div>
                          <div className="mt-0.5 text-sm font-semibold text-gray-900">
                            {vio > 0 ? `+${vio}` : String(vio)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-[11px] text-gray-500">Cộng sổ đầu bài</div>
                          <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">
                            +{bonus}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-[11px] text-gray-500">Tổng điểm</div>
                          <div
                            className={`mt-0.5 text-sm font-semibold ${
                              total >= 0 ? "text-emerald-700" : "text-red-600"
                            }`}
                          >
                            {total > 0 ? `+${total}` : String(total)}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">
                      {weekday(detail.session.date)} {formatDate(detail.session.date)}: Cờ đỏ {detail.session.red_class} trực {detail.session.duty_class}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Trạng thái: {formatDutyStatus(detail.session.status)}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={()=>editSession(detail.session.id)}
                        className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
                      >
                        Chỉnh sửa / Ký lại
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
                    {detail.session.signature_photo_path ? (
                      <img src={detail.session.signature_photo_path} className="w-full" />
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-500">
                        Chưa có ảnh ký
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-900">Vi phạm</div>
                    {detail.violations.length===0 ? (
                      <div className="text-sm text-gray-600">Không có vi phạm.</div>
                    ) : (
                      detail.violations.map((v:any)=>(
                        <div key={v.id} className="rounded-2xl border border-blue-100 bg-white px-4 py-3">
                          <div className="text-[15px] font-semibold text-gray-900">{v.name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{v.category} | x{v.quantity} ({v.score_delta})</div>
                          {v.note ? <div className="mt-1 text-xs text-gray-600">Ghi chú: {v.note}</div> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </div>

      <Footer/>

    </div>

  )

}
