import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import ChangePasswordModal from "../../components/ChangePasswordModal"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type ClassType = {
  id: number
  name: string
  grade: number
  is_active: number
}

const shortcutItems = [
  { label: "Quản lý lớp", hint: "Danh sách lớp và tài khoản", path: "/admin/classes" },
  { label: "Quản lý luật", hint: "Nhóm lỗi và điểm trừ", path: "/admin/rules" },
  { label: "Thời khóa biểu", hint: "Cấu hình lịch học", path: "/admin/timetable" },
  { label: "Lịch trực", hint: "Phân công tuần trực", path: "/admin/schedule" },
  { label: "Phiếu trực", hint: "Theo dõi phiếu đã tạo", path: "/admin/duty" },
  { label: "Tổng kết tuần", hint: "Kết quả thi đua tuần", path: "/admin/weekly-summary" },
  { label: "Tổng kết tháng", hint: "Điểm thi đua theo tháng", path: "/admin/month-summary" },
  { label: "Tổng kết học kỳ", hint: "Báo cáo học kỳ", path: "/admin/semester-summary" },
  { label: "Tổng kết năm học", hint: "Báo cáo năm học", path: "/admin/year-summary" },
  { label: "Cấu hình hệ thống", hint: "AI và tham số hệ thống", path: "/admin/system-settings" },
]

export default function AdminDashboard() {
  usePageTitle("EDP | Bảng điều khiển quản trị")

  const { user } = useAuth()
  const navigate = useNavigate()

  const [classes, setClasses] = useState<ClassType[]>([])
  const [loading, setLoading] = useState(true)
  const [showChangePassword, setShowChangePassword] = useState(false)

  useEffect(() => {
    void loadClasses()
  }, [])

  async function loadClasses() {
    try {
      setLoading(true)
      const res = await api.get<ClassType[]>("/classes/admin")
      setClasses(res.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const total = classes.length
  const active = classes.filter((item) => item.is_active).length
  const disabled = total - active

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="edp-glass-panel rounded-[32px] px-6 py-6 text-slate-900">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#2e77df]/70">
                Tổng quan quản trị
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Bảng điều khiển quản trị
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Tổng quan nhanh hệ thống EduDiscipline Platform, các lối tắt quản trị và thiết lập tài khoản quản trị.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 lg:min-w-[360px]">
              <div className="rounded-[24px] border border-white/70 bg-white/70 px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                <div className="text-xs text-slate-500">Tổng số lớp</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{loading ? "--" : total}</div>
              </div>
              <div className="rounded-[24px] border border-white/70 bg-white/70 px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                <div className="text-xs text-slate-500">Đang hoạt động</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-600">{loading ? "--" : active}</div>
              </div>
              <div className="rounded-[24px] border border-white/70 bg-white/70 px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                <div className="text-xs text-slate-500">Đã vô hiệu</div>
                <div className="mt-2 text-2xl font-semibold text-rose-600">{loading ? "--" : disabled}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Lối tắt quản trị</h2>
                <p className="mt-1 text-sm text-slate-500">Đi tới nhanh các màn hình quản lý chính của hệ thống.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shortcutItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="rounded-[24px] border border-white/70 bg-white/78 px-4 py-4 text-left shadow-[0_16px_30px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-0.5 hover:bg-white active:scale-[0.99]"
                >
                  <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
                Tài khoản
              </div>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">Đổi mật khẩu quản trị</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Cập nhật mật khẩu đăng nhập của tài khoản quản trị hiện tại mà không ảnh hưởng session đang hoạt động.
              </p>

              <div className="mt-5 rounded-[24px] border border-white/70 bg-white/78 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.05)]">
                <div className="text-xs text-slate-500">Đăng nhập hiện tại</div>
                <div className="mt-2 text-base font-semibold text-slate-900">{user?.username || "admin"}</div>
                <button
                  type="button"
                  onClick={() => setShowChangePassword(true)}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
                >
                  Đổi mật khẩu
                </button>
              </div>
            </section>

            <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
                Gợi ý
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                <p>Quản lý luật để đồng bộ điểm trừ và danh mục vi phạm trong toàn hệ thống.</p>
                <p>Cấu hình hệ thống là nơi kiểm tra API AI, chọn model và chỉnh các tham số gốc như điểm nền.</p>
              </div>
            </section>
          </div>
        </section>
      </div>

      <Footer />

      {showChangePassword && (
        <ChangePasswordModal
          role="admin"
          canClose
          onSuccess={() => setShowChangePassword(false)}
        />
      )}
    </div>
  )
}
