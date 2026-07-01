import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"
import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { usePageTitle } from "../../utils/usePageTitle"

type TimetableRow = {
  id: number
  effective_date: string
  file_name: string
  created_at: string
}

export default function AdminTimetable() {
  usePageTitle("EDP | Thời khóa biểu")

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rows, setRows] = useState<TimetableRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [className, setClassName] = useState("")
  const [lookup, setLookup] = useState<any[]>([])

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      const res = await api.get("/bonus/admin/timetables")
      setRows(res.data.timetables || [])
      const firstId = res.data.timetables?.[0]?.id ?? null
      setSelectedId(firstId)
    } catch {}
  }

  async function uploadTimetable() {
    if (!file) {
      alert("Vui lòng chọn file thời khóa biểu")
      return
    }
    setUploading(true)
    try {
      const ab = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(ab)
      const res = await api.post("/bonus/admin/upload-timetable", {
        file_data: base64,
        file_name: file.name,
      })
      alert(
        `Đã nhập thời khóa biểu.\nÁp dụng từ: ${res.data.effective_date}\nSố dòng: ${res.data.entry_count}`,
      )
      setFile(null)
      await load()
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể upload thời khóa biểu"
      alert(msg)
    } finally {
      setUploading(false)
    }
  }

  function formatDateVN(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  async function runLookup() {
    if (!selectedId || !className) {
      alert("Vui lòng chọn thời khóa biểu và nhập lớp")
      return
    }
    try {
      const res = await api.get(`/bonus/admin/timetable/${selectedId}`, {
        params: { class_name: className },
      })
      setLookup(res.data.entries || [])
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể tra cứu"
      alert(msg)
      setLookup([])
    }
  }

  function buildGrid() {
    const grid = new Map()
    for (const e of lookup) {
      const day = Number(e.day_of_week)
      const session = String(e.session || "")
      const period = Number(e.period)
      const key = `${day}|${session}|${period}`
      grid.set(key, String(e.subject || ""))
    }
    return grid
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Thời khóa biểu</span>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-xl font-semibold text-gray-900">Nhập thời khóa biểu</div>
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-[1fr_160px] gap-3">
            <div className="w-full">
              <label className="inline-flex h-11 w-full cursor-pointer items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-slate-50">
                <span>Chọn file thời khóa biểu</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setFile(f)
                  }}
                  className="hidden"
                />
              </label>
              <div className="mt-2 text-xs text-gray-500">
                {file ? file.name : "Chưa chọn file"}
              </div>
            </div>

            <button
              onClick={uploadTimetable}
              disabled={uploading}
              className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {uploading ? "Đang upload..." : "Upload TKB"}
            </button>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-sm font-semibold text-gray-900">Danh sách thời khóa biểu</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-3 border-b text-left w-16">#</th>
                  <th className="p-3 border-b text-left">Ngày áp dụng</th>
                  <th className="p-3 border-b text-left">File</th>
                  <th className="p-3 border-b text-left">Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-gray-500">
                      Chưa có thời khóa biểu
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="p-3 border-b">{idx + 1}</td>
                      <td className="p-3 border-b">{formatDateVN(r.effective_date)}</td>
                      <td className="p-3 border-b">{r.file_name}</td>
                      <td className="p-3 border-b">
                        {r.created_at ? r.created_at.replace("T", " ").slice(0, 19) : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-sm font-semibold text-gray-900">Tra cứu thời khóa biểu</div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_200px_140px] gap-3">
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
            >
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  Áp dụng {formatDateVN(r.effective_date)}
                </option>
              ))}
            </select>

            <input
              value={className}
              onChange={(e) => setClassName(e.target.value.toUpperCase())}
              placeholder="Nhập lớp (VD: 10A8)"
              className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
            />

            <button
              onClick={runLookup}
              className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Tra cứu
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            {lookup.length === 0 ? (
              <div className="text-sm text-gray-500">Chưa có dữ liệu để hiển thị.</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-3 border-b text-left w-24">Buổi</th>
                    <th className="p-3 border-b text-left w-16">Tiết</th>
                    <th className="p-3 border-b text-left">Thứ 2</th>
                    <th className="p-3 border-b text-left">Thứ 3</th>
                    <th className="p-3 border-b text-left">Thứ 4</th>
                    <th className="p-3 border-b text-left">Thứ 5</th>
                    <th className="p-3 border-b text-left">Thứ 6</th>
                    <th className="p-3 border-b text-left">Thứ 7</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const grid = buildGrid()
                    const rowsOut = []
                    for (const session of ["Sáng", "Chiều"]) {
                      for (let period = 1; period <= 5; period++) {
                        rowsOut.push(
                          <tr key={`${session}-${period}`} className="hover:bg-gray-50">
                            <td className="p-3 border-b">{session}</td>
                            <td className="p-3 border-b">{period}</td>
                            {[2, 3, 4, 5, 6, 7].map((day) => (
                              <td key={`${day}`} className="p-3 border-b">
                                {grid.get(`${day}|${session}|${period}`) || ""}
                              </td>
                            ))}
                          </tr>,
                        )
                      }
                    }
                    return rowsOut
                  })()}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
