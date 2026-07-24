import { useCallback, useEffect, useRef, useState } from "react"

import SelectorBackdrop from "./SelectorBackdrop"
import { useDismissibleSelector } from "../utils/useDismissibleSelector"

type ClassType = {
  id: number
  name: string
}

type Props = {
  classes: ClassType[]
  value: string
  onChange: (v: string) => void
}

export default function ClassSelector({ classes, value, onChange }: Props) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleSelector(open, close)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = classes.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const item = list.children[index] as HTMLElement
    if (!item) return

    item.scrollIntoView({
      block: "nearest",
    })
  }, [index])

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, filtered.length - 1))
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    }

    if (e.key === "Enter") {
      e.preventDefault()

      const c = filtered[index]

      if (c) {
        onChange(c.name)
        setQuery("")
        close()
      }
    }

    if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  }

  return (
    <div ref={rootRef} className={`relative ${open ? "z-50" : ""}`}>
      {open && <SelectorBackdrop onClose={close} />}
      <input
        className="edp-input w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2e77df] focus:ring-2 focus:ring-blue-100"
        placeholder="Tìm hoặc chọn lớp"
        value={value || query}
        onClick={(e) => {
          setIndex(0)
          setOpen(true)
          e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
        }}
        onKeyDown={handleKey}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
          onChange("")
          setOpen(true)
        }}
      />

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500">
                Không tìm thấy lớp phù hợp
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  type="button"
                  key={c.id}
                  className={`min-h-12 w-full px-4 py-3 text-left transition ${
                    i === index ? "bg-blue-50" : "hover:bg-slate-50"
                  }`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    onChange(c.name)
                    setQuery("")
                    close()
                  }}
                >
                  <div className="text-[15px] font-medium text-slate-900">{c.name}</div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            Gõ để tìm, Enter để chọn, Esc để đóng
          </div>
        </div>
      )}
    </div>
  )
}
