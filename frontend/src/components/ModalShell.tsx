import type { ReactNode } from "react"

type Props = {
  children: ReactNode
  className?: string
  onClose?: () => void
}

export default function ModalShell({ children, className = "", onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[8px]">
      <div
        className={`relative w-full rounded-[30px] border border-slate-100 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22),0_8px_24px_rgba(15,23,42,0.08)] ${className}`}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-[16px] bg-white text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition hover:text-slate-700"
            aria-label="Đóng"
          >
            ×
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
