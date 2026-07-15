import { useEffect, useRef, useState } from "react"

export type RuleType = {
  id: number
  category: string
  name: string
  score_delta: number
}

type Props = {
  rules: RuleType[]
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
}

export default function RuleSelector({
  rules,
  value,
  onChange,
  placeholder = "Chọn lỗi vi phạm",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)

  const selected = value != null ? rules.find((r) => r.id === value) : null

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = rules.filter((r) => {
    if (!normalizedQuery) return true
    return (
      r.name.toLowerCase().includes(normalizedQuery) ||
      r.category.toLowerCase().includes(normalizedQuery)
    )
  })

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const item = list.children[index] as HTMLElement
    if (!item) return

    item.scrollIntoView({ block: "nearest" })
  }, [index])

  useEffect(() => {
    if (!open) return

    function onOutside(e: MouseEvent | TouchEvent) {
      const root = rootRef.current
      const target = e.target as Node | null
      if (!root || !target) return
      if (!root.contains(target)) setOpen(false)
    }

    document.addEventListener("mousedown", onOutside)
    document.addEventListener("touchstart", onOutside)

    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("touchstart", onOutside)
    }
  }, [open])

  function pick(r: RuleType) {
    onChange(r.id)
    setQuery("")
    setOpen(false)
  }

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
      const r = filtered[index]
      if (r) pick(r)
    }

    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  const display = selected ? selected.name : ""

  return (
    <div ref={rootRef} className="relative">
      <input
        className="edp-input w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-[#2e77df] focus:ring-2 focus:ring-blue-200"
        placeholder={placeholder}
        value={display || query}
        onFocus={(e) => {
          setOpen(true)
          e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
        }}
        onKeyDown={handleKey}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
          onChange(null)
        }}
      />

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-lg"
        >
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500">
                Không tìm thấy lỗi phù hợp
              </div>
            ) : (
              filtered.map((r, i) => (
                <button
                  type="button"
                  key={r.id}
                  className={`min-h-12 w-full px-4 py-3 text-left transition ${
                    i === index ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(r)}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-gray-900">
                        {r.name}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {r.category}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        r.score_delta < 0
                          ? "bg-red-50 text-red-600"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {r.score_delta}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-blue-50 px-4 py-2 text-[11px] text-gray-500">
            Gõ để tìm, Enter để chọn, Esc để đóng
          </div>
        </div>
      )}
    </div>
  )
}
