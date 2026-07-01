import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { usePageTitle } from "../../utils/usePageTitle"

type ClassRow = {
  id: number
  name: string
  grade: number
  pin_bcs?: string | number | null
}

export default function AdminPinLookup() {
  usePageTitle("EDP | Tra cứu PIN")

  const [classes, setClasses] = useState<ClassRow[]>([])
  const [search, setSearch] = useState("")
  const [grade, setGrade] = useState("all")
  const [showPins, setShowPins] = useState(false)

  useEffect(() => {
    loadClasses()
  }, [])

  async function loadClasses() {
    const res = await api.get("/classes/admin")
    setClasses(res.data || [])
  }

  const filtered = useMemo(() => {
    return classes
      .filter((c) => (grade === "all" ? true : String(c.grade) === grade))
      .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
  }, [classes, grade, search])

  async function copyPin(pin: string) {
    try {
      await navigator.clipboard.writeText(pin)
      alert("Đã sao chép mã PIN")
    } catch {
      window.prompt("Sao chép mã PIN bên dưới:", pin)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-10 space-y-6">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Tra cứu PIN</span>
        </div>

        <div className="flex items-center">
          <h1 className="text-3xl font-semibold text-[#2e77df]">Tra cứu PIN lớp trưởng</h1>
          <button
            onClick={() => setShowPins((v) => !v)}
            className="ml-auto border px-4 py-2 rounded text-sm"
          >
            {showPins ? "Ẩn mã PIN" : "Hiện mã PIN"}
          </button>
        </div>

        <div className="flex flex-wrap gap-4 bg-white border p-4 rounded shadow-sm">
          <input
            placeholder="Tìm lớp..."
            className="border rounded px-3 py-2 w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="10">Khối 10</option>
            <option value="11">Khối 11</option>
            <option value="12">Khối 12</option>
          </select>
        </div>

        <div className="bg-white border shadow-sm overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4 border-b w-16 text-left">#</th>
                <th className="p-4 border-b text-left">Lớp</th>
                <th className="p-4 border-b w-20 text-left">Khối</th>
                <th className="p-4 border-b text-center">Mã PIN</th>
                <th className="p-4 border-b text-center">Sao chép</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-500">
                    Không có lớp nào
                  </td>
                </tr>
              ) : (
                filtered.map((c, index) => {
                  const pin = String(c.pin_bcs ?? "")
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="p-4 border-b">{index + 1}</td>
                      <td className="p-4 border-b font-medium">{c.name}</td>
                      <td className="p-4 border-b">{c.grade}</td>
                      <td className="p-4 border-b text-center font-semibold">
                        {showPins ? pin || "-" : "••••••"}
                      </td>
                      <td className="p-4 border-b text-center">
                        <button
                          onClick={() => copyPin(pin)}
                          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                          disabled={!pin}
                        >
                          COPY
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Footer />
    </div>
  )
}
