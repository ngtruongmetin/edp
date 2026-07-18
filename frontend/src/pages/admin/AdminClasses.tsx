import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import ModalShell from "../../components/ModalShell"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type ClassType = {
  id: number
  name: string
  grade: number
  is_active: number
}

type CreatedCredentials = {
  gvcn: string
  bcs: string
  codo: string
  pin: string
}

export default function AdminClasses() {
  usePageTitle("EDP | Quản lý lớp")

  const [classes, setClasses] = useState<ClassType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [grade, setGrade] = useState("all")
  const [showPasswords, setShowPasswords] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null)
  const [createdClassName, setCreatedClassName] = useState("")

  useEffect(() => {
    void loadClasses()
  }, [])

  const filteredClasses = useMemo(() => {
    return classes
      .filter((item) => (grade === "all" ? true : String(item.grade) === grade))
      .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  }, [classes, grade, search])

  async function loadClasses() {
    try {
      setLoading(true)
      const res = await api.get<ClassType[]>("/classes/admin")
      setClasses(res.data || [])
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được danh sách lớp")
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(id: number) {
    try {
      await api.patch(`/classes/${id}/toggle`)
      await loadClasses()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không cập nhật được trạng thái lớp")
    }
  }

  async function resetPassword(id: number, role: string) {
    const shouldReset = window.confirm("Reset mật khẩu tài khoản này?")
    if (!shouldReset) return

    try {
      const res = await api.post(`/classes/${id}/reset-password/${role}`)
      window.alert(`Mật khẩu mới: ${res.data.password}`)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không reset được mật khẩu")
    }
  }

  async function resetPin(id: number) {
    const shouldReset = window.confirm("Reset PIN Ban cán sự?")
    if (!shouldReset) return

    try {
      const res = await api.post(`/classes/${id}/reset-pin`)
      window.alert(`PIN mới: ${res.data.pin}`)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không reset được PIN")
    }
  }

  async function deleteClass(id: number, name: string) {
    const shouldDelete = window.confirm(`Xóa lớp ${name}?`)
    if (!shouldDelete) return

    try {
      await api.delete(`/classes/${id}`)
      toast.success("Đã xóa lớp")
      await loadClasses()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được lớp")
    }
  }

  async function createClass() {
    const name = createName.trim().toUpperCase()
    if (!name) {
      toast.error("Vui lòng nhập tên lớp")
      return
    }

    try {
      setCreating(true)
      const res = await api.post("/classes/create", { name })
      setCreatedClassName(name)
      setCreatedCredentials(res.data.passwords)
      setCreateName("")
      setShowCreateModal(false)
      toast.success("Đã tạo lớp mới")
      await loadClasses()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tạo được lớp")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="transition hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Quản lý lớp</span>
        </div>

        <section className="edp-glass-panel rounded-[32px] px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
                Quản lý lớp
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Quản lý lớp
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Quản lý trạng thái lớp, tài khoản mặc định và thao tác tạo mới trong cùng giao diện quản trị.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              + Tạo lớp mới
            </button>
          </div>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Danh sách lớp</h2>
              <p className="mt-1 text-sm text-slate-500">Tìm kiếm nhanh và quản lý tài khoản mặc định theo từng lớp.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm lớp..."
                className="w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] placeholder:text-slate-400 focus:border-[#2e77df] sm:w-64"
              />

              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#2e77df]"
              >
                <option value="all">Tất cả khối</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>

              <button
                type="button"
                onClick={() => setShowPasswords((current) => !current)}
                className="rounded-[20px] border border-white/70 bg-white/78 px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98]"
              >
                {showPasswords ? "Ẩn quản lý mật khẩu" : "Quản lý mật khẩu"}
              </button>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/90 text-slate-500">
                <tr>
                  <th className="px-4 py-4 text-left font-semibold">#</th>
                  <th className="px-4 py-4 text-left font-semibold">Lớp</th>
                  <th className="px-4 py-4 text-left font-semibold">Khối</th>
                  {showPasswords && (
                    <>
                      <th className="px-4 py-4 text-center font-semibold">GVCN</th>
                      <th className="px-4 py-4 text-center font-semibold">BCS</th>
                      <th className="px-4 py-4 text-center font-semibold">Cờ đỏ</th>
                      <th className="px-4 py-4 text-center font-semibold">PIN</th>
                    </>
                  )}
                  <th className="px-4 py-4 text-center font-semibold">Trạng thái</th>
                  <th className="px-4 py-4 text-right font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index} className="border-t border-slate-100/80">
                      <td className="px-4 py-4" colSpan={showPasswords ? 9 : 5}>
                        <div className="h-12 animate-pulse rounded-[18px] bg-slate-100/80" />
                      </td>
                    </tr>
                  ))
                ) : filteredClasses.length === 0 ? (
                  <tr>
                    <td colSpan={showPasswords ? 9 : 5} className="px-6 py-16 text-center text-sm text-slate-500">
                      Không có lớp phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredClasses.map((item, index) => (
                    <tr key={item.id} className="border-t border-slate-100/80 transition hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-slate-500">{index + 1}</td>
                      <td className="px-4 py-4 font-semibold text-slate-900">{item.name}</td>
                      <td className="px-4 py-4 text-slate-600">{item.grade}</td>
                      {showPasswords && (
                        <>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => void resetPassword(item.id, "gvcn")}
                              className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
                            >
                              RESET
                            </button>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => void resetPassword(item.id, "bcs")}
                              className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
                            >
                              RESET
                            </button>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => void resetPassword(item.id, "codo")}
                              className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
                            >
                              RESET
                            </button>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => void resetPin(item.id)}
                              className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
                            >
                              RESET
                            </button>
                          </td>
                        </>
                      )}
                      <td className="px-4 py-4 text-center">
                        <button
                          type="button"
                          onClick={() => void toggleActive(item.id)}
                          className={`min-h-10 rounded-full px-3 text-xs font-semibold transition duration-200 active:scale-[0.98] ${
                            item.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {item.is_active ? "Đang hoạt động" : "Đã vô hiệu"}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void deleteClass(item.id, item.name)}
                            className="min-h-10 rounded-[16px] border border-rose-100 bg-white px-3 text-xs font-semibold text-rose-600 transition duration-200 active:scale-[0.98]"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Footer />

      {showCreateModal && (
        <ModalShell className="max-w-lg p-6" onClose={() => !creating && setShowCreateModal(false)}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Tạo lớp mới</h2>
            <p className="mt-1 text-sm text-slate-600">Nhập tên lớp theo định dạng của hệ thống, ví dụ: 10A15.</p>
          </div>

          <div className="mt-5">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Tên lớp</span>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="10A15"
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              disabled={creating}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void createClass()}
              disabled={creating}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {creating ? "Đang tạo..." : "Tạo lớp"}
            </button>
          </div>
        </ModalShell>
      )}

      {createdCredentials && (
        <ModalShell className="max-w-xl p-6">
          <h2 className="text-xl font-semibold text-slate-900">Tạo lớp thành công</h2>
          <p className="mt-1 text-sm text-slate-600">
            Thông tin tài khoản mặc định của lớp <span className="font-semibold text-slate-900">{createdClassName}</span>.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Mật khẩu GVCN</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{createdCredentials.gvcn}</div>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Mật khẩu BCS</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{createdCredentials.bcs}</div>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Mật khẩu Cờ đỏ</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{createdCredentials.codo}</div>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">PIN BCS</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{createdCredentials.pin}</div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setCreatedCredentials(null)}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
            >
              Đã hiểu
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
