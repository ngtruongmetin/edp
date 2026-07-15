import { useEffect } from "react"

export default function useKeyboardInsets() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport

    const update = () => {
      const offset = viewport
        ? Math.max(
            0,
            Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
          )
        : 0

      root.style.setProperty("--edp-keyboard-offset", `${offset}px`)
    }

    update()

    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)

    if (viewport) {
      viewport.addEventListener("resize", update)
      viewport.addEventListener("scroll", update)
    }

    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)

      if (viewport) {
        viewport.removeEventListener("resize", update)
        viewport.removeEventListener("scroll", update)
      }

      root.style.removeProperty("--edp-keyboard-offset")
    }
  }, [])
}
