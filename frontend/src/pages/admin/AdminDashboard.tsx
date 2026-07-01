import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { usePageTitle } from "../../utils/usePageTitle"

type ClassType = {
  id:number
  name:string
  grade:number
  is_active:number
}

export default function AdminDashboard(){
  usePageTitle("EDP | Dashboard quản trị")

  const [classes,setClasses] = useState<ClassType[]>([])

  const navigate = useNavigate()

  useEffect(()=>{
    loadClasses()
  },[])

  async function loadClasses(){

    try{

      const res = await api.get("/classes/admin")
      setClasses(res.data)

    }catch(err){

      console.error(err)

    }

  }

  const total = classes.length
  const active = classes.filter(c=>c.is_active).length
  const disabled = classes.filter(c=>!c.is_active).length

  const [grade, setGrade] = useState(10)
  const [trendWeeks, setTrendWeeks] = useState<any[]>([])
  const [trendClasses, setTrendClasses] = useState<any[]>([])
  const [trendLoading, setTrendLoading] = useState(false)

  useEffect(() => {
    loadTrends(grade)
  }, [grade])

  async function loadTrends(g:number){
    try{
      setTrendLoading(true)
      const res = await api.get("/duty/admin/weekly-trends", { params: { grade: g } })
      setTrendWeeks(res.data.weeks || [])
      setTrendClasses(res.data.classes || [])
    }catch(err){
      console.error(err)
    }finally{
      setTrendLoading(false)
    }
  }

  const chartSeries = useMemo(() => {
    if (!trendClasses.length || !trendWeeks.length) return []
    const lastIndex = trendWeeks.length - 1
    const ranked = [...trendClasses].map((c) => {
      const last = c.scores?.[lastIndex]
      const total = (c.scores || []).reduce((s:number, v:number|null) => s + (Number(v) || 0), 0)
      return { ...c, lastScore: Number(last ?? 0), totalScore: total }
    })
    ranked.sort((a, b) => b.lastScore - a.lastScore)
    return ranked
  }, [trendClasses, trendWeeks])

  const yRange = useMemo(() => {
    const all = chartSeries.flatMap((s:any) => (s.scores || []).filter((v:any) => v != null))
    if (!all.length) return { min: 0, max: 1 }
    const min = Math.min(...all)
    const max = Math.max(...all)
    if (min === max) return { min: min - 1, max: max + 1 }
    return { min, max }
  }, [chartSeries])

  const palette = [
    "#2e77df",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#0ea5e9",
    "#16a34a",
    "#f97316",
  ]

  function formatScore(value:number){
    if (value > 0) return String(value)
    return String(value)
  }

  function formatDateVN(date:string){
    if(!date) return ""
    const [y,m,d] = String(date).split("-")
    return `${d}/${m}/${y}`
  }

  const avgSeries = useMemo(() => {
    if (!trendWeeks.length || !trendClasses.length) return []
    return trendWeeks.map((_:any, idx:number) => {
      const vals = trendClasses
        .map((c:any) => c.scores?.[idx])
        .filter((v:any) => v != null)
        .map((v:any) => Number(v))
      if (!vals.length) return null
      const sum = vals.reduce((s:number, v:number) => s + v, 0)
      return sum / vals.length
    })
  }, [trendWeeks, trendClasses])

  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)

  return(

    <div className="min-h-screen flex flex-col bg-slate-50">

      <Navbar/>

      <div className="flex-1 px-6 py-10 max-w-7xl mx-auto w-full space-y-8">

        {/* Header */}
        <div className="rounded-3xl bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-lg">
          <div className="px-8 py-7 flex flex-col lg:flex-row lg:items-center lg:gap-8">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] text-white/70">
                Admin Control
              </div>
              <h1 className="mt-2 text-3xl font-semibold">Dashboard quản trị</h1>
              <p className="mt-2 text-sm text-white/80">
                Tổng quan hệ thống và lối tắt quản lý nhanh.
              </p>
            </div>
            <div className="mt-5 lg:mt-0 lg:ml-auto grid grid-cols-3 gap-3 w-full lg:w-auto">
              <div className="rounded-2xl bg-white/15 px-4 py-3">
                <div className="text-xs text-white/80">Tổng số lớp</div>
                <div className="mt-1 text-2xl font-semibold">{total}</div>
              </div>
              <div className="rounded-2xl bg-white/15 px-4 py-3">
                <div className="text-xs text-white/80">Đang hoạt động</div>
                <div className="mt-1 text-2xl font-semibold">{active}</div>
              </div>
              <div className="rounded-2xl bg-white/15 px-4 py-3">
                <div className="text-xs text-white/80">Đã vô hiệu</div>
                <div className="mt-1 text-2xl font-semibold">{disabled}</div>
              </div>
            </div>
          </div>
        </div>
        {/* Quick Actions */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Lối tắt quản trị</h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { label: "Quản lý lớp", path: "/admin/classes" },
              { label: "Tra cứu PIN", path: "/admin/pin-lookup" },
              { label: "Quản lý luật", path: "/admin/rules" },
              { label: "Thời khóa biểu", path: "/admin/timetable" },
              { label: "Lịch trực", path: "/admin/schedule" },
              { label: "Phiếu trực", path: "/admin/duty" },
              { label: "Tổng kết tuần", path: "/admin/weekly-summary" },
              { label: "Tổng kết tháng", path: "/admin/month-summary" },
              { label: "Tổng kết học kỳ", path: "/admin/semester-summary" },
              { label: "Tổng kết năm học", path: "/admin/year-summary" },
            ].map((a) => (
              <button
                key={a.path}
                onClick={() => navigate(a.path)}
                className="group rounded-2xl border border-blue-100 bg-white px-4 py-4 text-left shadow-sm hover:bg-slate-50 transition"
              >
                <div className="text-sm font-semibold text-gray-900">{a.label}</div>
                <div className="mt-2 text-xs text-gray-500">Mở nhanh</div>
              </button>
            ))}
          </div>
        </div>
        {/* Weekly Ranking Trend */}

        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-blue-50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-gray-900">Xếp hạng theo tuần</div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-500">Chọn khối</span>
              <select
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
                className="rounded-2xl border border-blue-100 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value={10}>Khối 10</option>
                <option value={11}>Khối 11</option>
                <option value={12}>Khối 12</option>
              </select>
            </div>
          </div>

          {trendLoading ? (
            <div className="mt-4 text-sm text-gray-600">Đang tải biểu đồ...</div>
          ) : chartSeries.length === 0 ? (
            <div className="mt-4 text-sm text-gray-600">Chưa có dữ liệu tuần.</div>
          ) : (
            <div className="mt-5 grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="relative rounded-2xl border border-blue-100 p-4">
                  <div className="text-xs text-gray-500 mb-3">
                    Biểu đồ đường (tất cả lớp trong khối)
                  </div>
                  <svg
                    viewBox="0 0 600 240"
                    className="w-full h-56"
                    onMouseMove={(e) => {
                      const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
                      const x = e.clientX - rect.left
                      const y = e.clientY - rect.top
                      const xRatio = x / rect.width
                      const idx = Math.round(xRatio * Math.max(0, trendWeeks.length - 1))
                      setHover({ index: Math.max(0, Math.min(idx, trendWeeks.length - 1)), x, y })
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    <rect x="0" y="0" width="600" height="240" fill="#ffffff" />
                    <g stroke="#e5e7eb" strokeWidth="1">
                      {[40, 80, 120, 160, 200].map((y) => (
                        <line key={y} x1="40" y1={y} x2="580" y2={y} />
                      ))}
                    </g>
                    <g stroke="#cbd5f5" strokeWidth="1">
                      <line x1="40" y1="20" x2="40" y2="220" />
                      <line x1="580" y1="20" x2="580" y2="220" />
                    </g>
                    {chartSeries.map((s:any, idx:number) => {
                      const color = palette[idx % palette.length]
                      const points = (s.scores || []).map((v:number|null, i:number) => {
                        const x = 40 + (i * (540 / Math.max(1, trendWeeks.length - 1)))
                        const val = v == null ? yRange.min : Number(v)
                        const t = (val - yRange.min) / (yRange.max - yRange.min || 1)
                        const y = 220 - t * 200
                        return `${x},${y}`
                      }).join(" ")
                      return <polyline key={s.class_name} fill="none" stroke={color} strokeWidth="2" points={points} />
                    })}
                    {avgSeries.length > 0 && (
                      <polyline
                        fill="none"
                        stroke="#111827"
                        strokeWidth="2.5"
                        strokeDasharray="6 6"
                        points={avgSeries
                          .map((v, i) => {
                            const x = 40 + (i * (540 / Math.max(1, trendWeeks.length - 1)))
                            const val = v == null ? yRange.min : Number(v)
                            const t = (val - yRange.min) / (yRange.max - yRange.min || 1)
                            const y = 220 - t * 200
                            return `${x},${y}`
                          })
                          .join(" ")}
                      />
                    )}
                    {hover && (
                      <line
                        x1={40 + (hover.index * (540 / Math.max(1, trendWeeks.length - 1)))}
                        y1="20"
                        x2={40 + (hover.index * (540 / Math.max(1, trendWeeks.length - 1)))}
                        y2="220"
                        stroke="#93c5fd"
                        strokeWidth="1"
                      />
                    )}
                  </svg>

                  {hover && trendWeeks[hover.index] && (
                    <div
                      className="absolute z-10 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs shadow-sm"
                      style={{ left: Math.min(hover.x + 12, 440), top: Math.max(hover.y - 10, 10) }}
                    >
                      <div className="font-semibold text-gray-900">
                        Tuần {trendWeeks[hover.index].week_number}
                      </div>
                      <div className="text-gray-500">
                        {formatDateVN(trendWeeks[hover.index].start_date)} - {formatDateVN(trendWeeks[hover.index].end_date)}
                      </div>
                      <div className="mt-2 text-gray-600">
                        Điểm TB:{" "}
                        <span className="font-semibold text-gray-900">
                          {avgSeries[hover.index] != null ? formatScore(Number(avgSeries[hover.index]?.toFixed(1))) : "--"}
                        </span>
                      </div>
                      <div className="mt-2 text-gray-600">Top 5 tuần này</div>
                      <div className="mt-1 space-y-1">
                        {[...chartSeries]
                          .map((c:any) => ({
                            class_name: c.class_name,
                            score: c.scores?.[hover.index],
                          }))
                          .filter((c:any) => c.score != null)
                          .sort((a:any, b:any) => Number(b.score) - Number(a.score))
                          .slice(0, 5)
                          .map((c:any) => (
                            <div key={c.class_name} className="flex items-center gap-2">
                              <div className="min-w-[48px] font-semibold text-gray-900">{c.class_name}</div>
                              <div className="text-gray-700">{formatScore(Number(c.score))}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 p-4">
                <div className="text-xs text-gray-500">Bảng xếp hạng (tuần gần nhất)</div>
                <div className="mt-3 space-y-2">
                  {chartSeries.map((s:any, idx:number) => (
                    <div key={s.class_name} className="flex items-center gap-3">
                      <div className="w-6 text-xs text-gray-500">#{idx + 1}</div>
                      <div className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
                        {s.class_name}
                      </div>
                      <div className="text-sm font-semibold text-gray-900">
                        {formatScore(Number(s.lastScore))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>



      </div>

      <Footer/>

    </div>

  )

} 
