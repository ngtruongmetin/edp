import { Link } from "react-router-dom"
import { usePageTitle } from "../utils/usePageTitle"

export default function NotFound() {
  usePageTitle("EDP | Không tìm thấy")

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <img
            src="/logo.png"
            alt="Logo Trường THPT Nguyễn Trãi - Bình Dương"
            className="mx-auto h-12 w-12 rounded-2xl border border-slate-200 object-cover"
          />

          <div className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[#2e77df]">
            EduDiscipline Platform
          </div>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-slate-900">404</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Trang bạn truy cập không tồn tại hoặc đã được chuyển đi.
          </p>

          <div className="mt-6">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-2xl bg-[#2e77df] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245fc0] active:translate-y-px"
            >
              Về trang chủ
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
