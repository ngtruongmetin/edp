import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { usePageTitle } from "../../utils/usePageTitle"

type Rule = {
  id:number
  category:string
  name:string
  score_delta:number
}

export default function AdminRules(){
  usePageTitle("EDP | Quản lý lỗi")

  const [rules,setRules] = useState<Rule[]>([])
  const [search,setSearch] = useState("")

  useEffect(()=>{
    loadRules()
  },[])



  async function loadRules(){

    const res = await api.get("/rules/admin")
    setRules(res.data)

  }



  async function createRule(){

    const category = prompt("Nhập nhóm lỗi (ví dụ: Chuyên cần)")
    if(!category) return

    const name = prompt("Tên lỗi")
    if(!name) return

    const score = prompt("Điểm trừ (ví dụ: -10)")

    await api.post("/rules/create",{
      category,
      name,
      score_delta:Number(score)
    })

    loadRules()

  }



  async function editRule(r:Rule){

    const category = prompt("Category",r.category)
    if(!category) return

    const name = prompt("Tên lỗi",r.name)
    if(!name) return

    const score = prompt("Điểm",String(r.score_delta))

    await api.patch(`/rules/${r.id}`,{
      category,
      name,
      score_delta:Number(score)
    })

    loadRules()

  }



  async function deleteRule(id:number){

    if(!confirm("Xóa luật này?")) return

    await api.delete(`/rules/${id}`)

    loadRules()

  }



  const filtered = rules.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.category.toLowerCase().includes(search.toLowerCase())
  )



  return(

    <div className="min-h-screen flex flex-col bg-gray-50">

      <Navbar/>

      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">


        {/* Breadcrumb */}

        <div className="text-sm text-gray-500 flex items-center gap-2">

          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>

          <span>/</span>

          <span className="font-medium text-gray-700">
            Quản lý luật
          </span>

        </div>



        {/* Header */}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">

          <h1 className="text-2xl sm:text-3xl font-semibold text-[#2e77df]">
            Quản lý luật thi đua
          </h1>

          <button
            onClick={createRule}
            className="sm:ml-auto bg-[#2e77df] text-white px-4 py-2 rounded hover:bg-[#1f5fc0] transition"
          >
            + Tạo lỗi mới
          </button>

        </div>



        {/* Search */}

        <div className="flex flex-wrap gap-4 bg-white border p-4 rounded shadow-sm">

          <input
            placeholder="Tìm luật..."
            className="border rounded px-3 py-2 w-full sm:w-64"
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />

        </div>



        {/* Table */}

        <div className="bg-white border shadow-sm overflow-x-auto">

          <table className="w-full text-sm border-collapse min-w-[600px]">

            <thead className="bg-gray-100">

              <tr>

                <th className="p-3 border-b w-16 text-left">
                  #
                </th>

                <th className="p-3 border-b text-left">
                  Nhóm
                </th>

                <th className="p-3 border-b text-left">
                  Tên lỗi
                </th>

                <th className="p-3 border-b w-24 text-left">
                  Điểm
                </th>

                <th className="p-3 border-b text-center w-40">
                  Hành động
                </th>

              </tr>

            </thead>



            <tbody>

              {filtered.length===0 ?(

                <tr>

                  <td colSpan={5} className="p-6 text-center text-gray-500">
                    Không có luật
                  </td>

                </tr>

              ):filtered.map((r,index)=>(

                <tr key={r.id} className="hover:bg-gray-50">

                  <td className="p-3 border-b">
                    {index+1}
                  </td>

                  <td className="p-3 border-b">
                    {r.category}
                  </td>

                  <td className="p-3 border-b font-medium">
                    {r.name}
                  </td>

                  <td className="p-3 border-b">
                    {r.score_delta}
                  </td>

                  <td className="p-3 border-b text-center">

                    <div className="flex flex-col sm:flex-row justify-center gap-2">

                      <button
                        onClick={()=>editRule(r)}
                        className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                      >
                        Sửa
                      </button>

                      <button
                        onClick={()=>deleteRule(r.id)}
                        className="px-3 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                      >
                        Xóa
                      </button>

                    </div>

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
