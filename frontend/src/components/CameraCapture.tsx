import { useEffect, useRef, useState } from "react"

type Props = {
  value: string | null
  onChange: (pngDataUrl: string | null) => void
}

export default function CameraCapture({ value, onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      })

      streamRef.current = stream
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        await v.play()
      }
      setActive(true)
    } catch (e: any) {
      setError(e?.message || "Không thể mở camera")
      setActive(false)
    }
  }

  function stop() {
    const s = streamRef.current
    if (s) {
      s.getTracks().forEach((t) => t.stop())
    }
    streamRef.current = null
    setActive(false)
  }
    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0]
      if (!file) return

      stop() // tắt camera nếu đang bật

      const reader = new FileReader()
      reader.onload = () => {
        onChange(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
    function capture() {
    const v = videoRef.current
    if (!v) return

    const w = v.videoWidth || 1280
    const h = v.videoHeight || 720

    const maxW = 1280
    const scale = w > maxW ? maxW / w : 1
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement("canvas")
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.drawImage(v, 0, 0, cw, ch)
    const png = canvas.toDataURL("image/jpeg", 0.8)
    onChange(png)
  }

  // Ensure video is hooked back up when switching from "captured image" to preview.
  useEffect(() => {
    const v = videoRef.current
    const s = streamRef.current
    if (!v || !s) return
    if (!active) return
    if (v.srcObject !== s) v.srcObject = s
    if (!value) {
      v.play().catch(() => {})
    }
  }, [active, value])

  useEffect(() => {
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
        <div className="relative">
          <video
            ref={videoRef}
            className={`w-full ${active ? "block" : "hidden"}`}
            playsInline
            muted
          />

          {!active && (
            <div className="h-44 flex items-center justify-center text-sm text-gray-500">
              Camera chưa bật
            </div>
          )}

          {value ? (
            <img
              src={value}
              alt="capture"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </div>
      </div>

      {error ? <div className="text-xs text-red-600">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        {!active ? (
          <button
            type="button"
            onClick={start}
            className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
          >
            Bật camera
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={capture}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Chụp ảnh
            </button>
            <button
              type="button"
              onClick={stop}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
            >
              Tắt camera
            </button>
          </>
        )}

        {value ? (
          <button
            type="button"
            onClick={async () => {
              onChange(null)
              // If camera is already active, just resume preview. If not, start it.
              if (streamRef.current && videoRef.current) {
                videoRef.current.srcObject = streamRef.current
                await videoRef.current.play().catch(() => {})
                return
              }
              if (!active) await start()
            }}
            className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
          >
            Chụp lại
          </button>
        ) : null}
          <label className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 cursor-pointer">
            Chọn ảnh từ Album
            <input
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            /> 
          </label>
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Nếu không chụp ảnh được, hãy chọn ảnh từ Album.
      </div>

    </div>
  )
}
