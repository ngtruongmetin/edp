import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
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

export default function AdminClasses(){
  usePageTitle("EDP | Quản lý lớp")

  const [classes,setClasses] = useState<ClassType[]>([])
  const [search,setSearch] = useState("")
  const [grade,setGrade] = useState("all")

  const [showPasswords,setShowPasswords] = useState(false)

  useEffect(()=>{
    loadClasses()
  },[])



  async function loadClasses(){

    const res = await api.get("/classes/admin")
    setClasses(res.data)

  }



  async function toggleActive(id:number){

    await api.patch(`/classes/${id}/toggle`)
    loadClasses()

  }



  async function resetPassword(id:number,role:string){

    if(!confirm("Reset mật khẩu?")) return

    const res = await api.post(`/classes/${id}/reset-password/${role}`)

    alert("Mật khẩu mới: "+res.data.password)

  }



  async function resetPin(id:number){

    if(!confirm("Reset PIN BCS?")) return

    const res = await api.post(`/classes/${id}/reset-pin`)

    alert("PIN mới: "+res.data.pin)

  }



  async function deleteClass(id:number){

    if(!confirm("Xóa lớp này?")) return

    await api.delete(`/classes/${id}`)

    loadClasses()

  }



  async function createClass(){

    const name = prompt("Nhập tên lớp (ví dụ: 10A15)")

    if(!name) return

    const res = await api.post("/classes/create",{name})

    alert(`
Tạo lớp thành công

GVCN: ${res.data.passwords.gvcn}
BCS: ${res.data.passwords.bcs}
Cờ đỏ: ${res.data.passwords.codo}
PIN: ${res.data.passwords.pin}
    `)

    loadClasses()

  }



  const filtered = classes
    .filter(c => {

      if(grade==="all") return true

      return String(c.grade) === grade

    })
    .filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase())
    )



  return(

    <div className="min-h-screen flex flex-col bg-gray-50">

      <Navbar/>

      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-6">


        {/* Breadcrumb */}

        <div className="text-sm text-gray-500 flex items-center gap-2">

          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>

          <span>/</span>

          <span className="font-medium text-gray-700">
            Quản lý lớp
          </span>

        </div>


        {/* Header */}

        <div className="flex items-center">

          <h1 className="text-3xl font-semibold text-[#2e77df]">
            Quản lý lớp
          </h1>

          <button
            onClick={createClass}
            className="ml-auto bg-[#2e77df] text-white px-5 py-2 rounded hover:bg-[#1f5fc0] transition"
          >
            + Tạo lớp mới
          </button>

        </div>



        {/* Filters */}

        <div className="flex flex-wrap gap-4 bg-white border p-4 rounded shadow-sm">

          <input
            placeholder="Tìm lớp..."
            className="border rounded px-3 py-2 w-64"
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2"
            value={grade}
            onChange={e=>setGrade(e.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="10">Khối 10</option>
            <option value="11">Khối 11</option>
            <option value="12">Khối 12</option>
          </select>


          <button
            onClick={()=>setShowPasswords(!showPasswords)}
            className="border px-4 py-2 rounded"
          >
            {showPasswords ? "Ẩn quản lý mật khẩu" : "Quản lý mật khẩu"}
          </button>

        </div>



        {/* Table */}

        <div className="bg-white border shadow-sm overflow-x-auto">

          <table className="w-full text-sm border-collapse">

            <thead className="bg-gray-100">

              <tr>

                <th className="p-4 border-b w-16 text-left">#</th>
                <th className="p-4 border-b text-left">Lớp</th>
                <th className="p-4 border-b w-20 text-left">Khối</th>

                {showPasswords && (

                  <>
                    <th className="p-4 border-b text-center">GVCN</th>
                    <th className="p-4 border-b text-center">BCS</th>
                    <th className="p-4 border-b text-center">Cờ đỏ</th>
                    <th className="p-4 border-b text-center">PIN</th>
                  </>

                )}

                <th className="p-4 border-b text-center">Active</th>
                <th className="p-4 border-b text-center">Xóa</th>

              </tr>

            </thead>



            <tbody>

              {filtered.length===0 ?(

                <tr>
                  <td colSpan={10} className="p-6 text-center text-gray-500">
                    Không có lớp nào
                  </td>
                </tr>

              ):filtered.map((c,index)=>(

                <tr key={c.id} className="hover:bg-gray-50">

                  <td className="p-4 border-b">{index+1}</td>

                  <td className="p-4 border-b font-medium">{c.name}</td>

                  <td className="p-4 border-b">{c.grade}</td>



                  {showPasswords && (

                    <>
                      <td className="p-4 border-b text-center">

                        <button
                          onClick={()=>resetPassword(c.id,"gvcn")}
                          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          RESET
                        </button>

                      </td>

                      <td className="p-4 border-b text-center">

                        <button
                          onClick={()=>resetPassword(c.id,"bcs")}
                          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          RESET
                        </button>

                      </td>

                      <td className="p-4 border-b text-center">

                        <button
                          onClick={()=>resetPassword(c.id,"codo")}
                          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          RESET
                        </button>

                      </td>

                      <td className="p-4 border-b text-center">

                        <button
                          onClick={()=>resetPin(c.id)}
                          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          RESET
                        </button>

                      </td>
                    </>

                  )}



                  <td className="p-4 border-b text-center">

                    <button
                      onClick={()=>toggleActive(c.id)}
                      className={`px-3 py-1 rounded text-xs ${
                        c.is_active
                          ? "bg-green-500 text-white"
                          : "bg-gray-400 text-white"
                      }`}
                    >

                      {c.is_active ? "Active" : "Disabled"}

                    </button>

                  </td>



                  <td className="p-4 border-b text-center">

                    <button
                      onClick={()=>deleteClass(c.id)}
                      className="px-3 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                    >
                      Xóa
                    </button>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </div>

      <Footer/>

    </div>

  )

}
