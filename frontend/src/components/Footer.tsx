export default function Footer() {
  return (
    <footer className="mt-14 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-6 text-sm text-slate-500 sm:px-6 lg:px-8">
        <img
          src="/logo.png"
          alt="Logo EDP"
          className="h-10 w-10 rounded-2xl border border-slate-200 bg-white object-cover"
        />
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">EduDiscipline Platform</div>
          <div className="truncate">Trường THPT Nguyễn Trãi - Bình Dương</div>
        </div>
      </div>
    </footer>
  )
}
