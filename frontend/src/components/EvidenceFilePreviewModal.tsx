import { useEffect, useMemo, useState } from "react"

export type EvidencePreviewFile = {
  id?: number
  file_name: string
  mime_type?: string
  url: string
}

type Props = {
  files: EvidencePreviewFile[]
  initialIndex: number
  onClose: () => void
}

function isImage(file: EvidencePreviewFile) {
  return file.mime_type?.startsWith("image/")
}

export default function EvidenceFilePreviewModal({ files, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(files.length - 1, 0)))
  const [zoom, setZoom] = useState(1)
  const current = files[index]
  const hasMultipleFiles = files.length > 1

  const filePosition = useMemo(() => `${index + 1}/${files.length}`, [index, files.length])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowLeft" && hasMultipleFiles) {
        setIndex((currentIndex) => Math.max(0, currentIndex - 1))
        setZoom(1)
      }
      if (event.key === "ArrowRight" && hasMultipleFiles) {
        setIndex((currentIndex) => Math.min(files.length - 1, currentIndex + 1))
        setZoom(1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [files.length, hasMultipleFiles, onClose])

  if (!current) return null

  function showPrevious() {
    setIndex((currentIndex) => Math.max(0, currentIndex - 1))
    setZoom(1)
  }

  function showNext() {
    setIndex((currentIndex) => Math.min(files.length - 1, currentIndex + 1))
    setZoom(1)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-md sm:p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Xem trước ${current.file_name}`}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/15 bg-slate-950 shadow-[0_30px_90px_rgba(15,23,42,0.45)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-white/10 bg-slate-900 px-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{current.file_name}</p>
            {hasMultipleFiles && <p className="mt-0.5 text-xs text-slate-400">Tệp {filePosition}</p>}
          </div>
          {isImage(current) && (
            <div className="flex items-center gap-2">
              <button type="button" title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={zoom === 1} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-lg font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">-</button>
              <button type="button" title="Phóng to" aria-label="Phóng to" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} disabled={zoom === 3} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-lg font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">+</button>
            </div>
          )}
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-white/15 px-3 text-sm font-semibold text-white transition hover:bg-white/10">Đóng</button>
        </header>

        <div className="min-h-0 flex-1 bg-slate-950">
          {isImage(current) ? (
            <div className="flex h-full min-h-[58dvh] items-center justify-center overflow-auto p-4 sm:p-8">
              <img
                src={current.url}
                alt={current.file_name}
                className="max-h-[72dvh] max-w-full origin-center object-contain transition-transform duration-200"
                style={{ transform: `scale(${zoom})` }}
              />
            </div>
          ) : (
            <iframe title={current.file_name} src={current.url} className="h-[72dvh] min-h-[58dvh] w-full bg-white" />
          )}
        </div>

        {hasMultipleFiles && (
          <footer className="flex items-center justify-between gap-3 border-t border-white/10 bg-slate-900 p-3 sm:p-4">
            <button type="button" onClick={showPrevious} disabled={index === 0} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">Trước</button>
            <span className="text-sm font-medium text-slate-300">Tệp {filePosition}</span>
            <button type="button" onClick={showNext} disabled={index === files.length - 1} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">Sau</button>
          </footer>
        )}
      </section>
    </div>
  )
}
