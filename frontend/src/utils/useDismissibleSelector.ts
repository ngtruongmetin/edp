import { useEffect, useRef } from "react"

export function useDismissibleSelector(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current
      const target = event.target as Node | null

      if (root && target && !root.contains(target)) {
        onClose()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return

      event.preventDefault()
      onClose()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, open])

  return rootRef
}
