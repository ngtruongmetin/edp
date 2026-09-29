import { useEffect, useRef } from "react"
import SignaturePad from "signature_pad"

const VIEWBOX_WIDTH = 600
const VIEWBOX_HEIGHT = 240

type Props = {
  value: string
  onChange: (svg: string) => void
}

export const SIGNATURE_VIEWBOX = {
  width: VIEWBOX_WIDTH,
  height: VIEWBOX_HEIGHT,
}

export default function SignaturePadField({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePad(canvas, {
      penColor: "#0f172a",
      minWidth: 0.8,
      maxWidth: 2.6,
      velocityFilterWeight: 0.7,
      minDistance: 2,
      backgroundColor: "#ffffff",
    })
    padRef.current = pad

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      const data = pad.toData()
      canvas.width = Math.max(1, Math.round(rect.width * ratio))
      canvas.height = Math.max(1, Math.round(rect.height * ratio))
      canvas.getContext("2d")?.scale(ratio, ratio)
      pad.clear()
      if (data.length) pad.fromData(data)
    }

    pad.addEventListener("endStroke", () => onChangeRef.current(pad.isEmpty() ? "" : pad.toSVG()))
    resize()
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      pad.off()
      padRef.current = null
    }
  }, [])

  useEffect(() => {
    const pad = padRef.current
    if (!pad) return
    if (!value && !pad.isEmpty()) pad.clear()
  }, [value])

  function clear() {
    padRef.current?.clear()
    onChange("")
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="relative aspect-[5/2] w-full">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full touch-none"
            aria-label="Vùng ký xác nhận"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">Ký bằng chuột, tay hoặc bút cảm ứng</span>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Xóa / ký lại
        </button>
      </div>
    </div>
  )
}
