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

    stop()

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
            className={`aspect-[4/3] w-full object-cover ${active ? "block" : "hidden"}`}
            playsInline
            muted
          />

          {!active && (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-gray-500">
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
            className="min-h-14 rounded-2xl bg-[#2e77df] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
          >
            Bật camera
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={capture}
              className="min-h-14 rounded-2xl bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
            >
              Chụp ảnh
            </button>
            <button
              type="button"
              onClick={stop}
              className="min-h-14 rounded-2xl bg-white px-4 py-3 text-[15px] font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 transition active:scale-[0.98]"
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
              if (streamRef.current && videoRef.current) {
                videoRef.current.srcObject = streamRef.current
                await videoRef.current.play().catch(() => {})
                return
              }
              if (!active) await start()
            }}
            className="min-h-14 rounded-2xl bg-white px-4 py-3 text-[15px] font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 transition active:scale-[0.98]"
          >
            Chụp lại
          </button>
        ) : null}

        <label className="min-h-14 cursor-pointer rounded-2xl bg-white px-4 py-3 text-[15px] font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 transition active:scale-[0.98]">
          Chọn ảnh từ Album
          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
        </label>
      </div>

      <div className="mt-1 text-xs text-gray-500">
        Nếu không chụp ảnh được, hãy chọn ảnh từ Album.
      </div>
    </div>
  )
}
