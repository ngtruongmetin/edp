import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import RequireRole from "../../components/RequireRole"
import { api } from "../../api/api"
import { useAuth } from "../../auth/AuthContext"
import ChangePasswordModal from "../../components/ChangePasswordModal"
import toast from "react-hot-toast"

type FabPosition = {
  x: number
  y: number
}

const FAB_SIZE = 64
const FAB_MARGIN = 16
const FAB_STORAGE_KEY = "edp:codo-ai-fab-position:v1"

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" />
      <path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" />
    </svg>
  )
}

function clampFabPosition(position: FabPosition): FabPosition {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const topInset = width <= 768 ? 88 : 24
  const bottomInset = width <= 768 ? 112 : 24
  const minX = FAB_MARGIN
  const maxX = Math.max(FAB_MARGIN, width - FAB_SIZE - FAB_MARGIN)
  const minY = topInset
  const maxY = Math.max(topInset, height - FAB_SIZE - bottomInset)

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  }
}

function getDefaultFabPosition(): FabPosition {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight

  return clampFabPosition({
    x: width - FAB_SIZE - FAB_MARGIN,
    y: height * 0.45,
  })
}

function CoDoFloatingAssistantFab() {
  const location = useLocation()
  const navigate = useNavigate()
  const [position, setPosition] = useState<FabPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    moved: false,
  })
  const frameRef = useRef<number | null>(null)
  const pendingPositionRef = useRef<FabPosition | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    let nextPosition = getDefaultFabPosition()

    try {
      const saved = window.localStorage.getItem(FAB_STORAGE_KEY)
      if (saved) {
        nextPosition = clampFabPosition(JSON.parse(saved) as FabPosition)
      }
    } catch (err) {
      console.error(err)
    }

    setPosition(nextPosition)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleViewportChange = () => {
      setPosition((current) => {
        const next = clampFabPosition(current ?? getDefaultFabPosition())
        window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
        return next
      })
    }

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("orientationchange", handleViewportChange)
    window.visualViewport?.addEventListener("resize", handleViewportChange)
    window.visualViewport?.addEventListener("scroll", handleViewportChange)

    return () => {
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("orientationchange", handleViewportChange)
      window.visualViewport?.removeEventListener("resize", handleViewportChange)
      window.visualViewport?.removeEventListener("scroll", handleViewportChange)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  if (location.pathname === "/co_do/duty-assistant" || !position) {
    return null
  }

  const schedulePosition = (next: FabPosition) => {
    pendingPositionRef.current = next

    if (frameRef.current != null) return

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      if (pendingPositionRef.current) {
        setPosition(pendingPositionRef.current)
      }
    })
  }

  const commitPosition = (next: FabPosition) => {
    setPosition(next)
    window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragStateRef.current.startX
    const deltaY = event.clientY - dragStateRef.current.startY

    if (!dragStateRef.current.moved && Math.hypot(deltaX, deltaY) > 6) {
      dragStateRef.current.moved = true
    }

    const next = clampFabPosition({
      x: event.clientX - dragStateRef.current.offsetX,
      y: event.clientY - dragStateRef.current.offsetY,
    })

    schedulePosition(next)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.pointerId !== event.pointerId) return

    event.currentTarget.releasePointerCapture(event.pointerId)

    const current = pendingPositionRef.current ?? position ?? getDefaultFabPosition()
    const viewport = window.visualViewport
    const width = viewport?.width ?? window.innerWidth
    const leftX = FAB_MARGIN
    const rightX = width - FAB_SIZE - FAB_MARGIN
    const snapX =
      current.x + FAB_SIZE / 2 < width / 2 ? leftX : rightX

    const snapped = clampFabPosition({
      x: snapX,
      y: current.y,
    })

    const wasDragged = dragStateRef.current.moved
    dragStateRef.current.pointerId = -1
    pendingPositionRef.current = null
    commitPosition(snapped)
    setIsDragging(false)

    if (!wasDragged) {
      navigate("/co_do/duty-assistant")
    }
  }

  const handlePointerCancel = () => {
    dragStateRef.current.pointerId = -1
    pendingPositionRef.current = null
    setIsDragging(false)
    setPosition((current) => {
      const next = clampFabPosition(current ?? getDefaultFabPosition())
      window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={`fixed z-40 flex h-16 w-16 items-center justify-center rounded-full border border-white/45 bg-white/24 text-[#2e77df] backdrop-blur-2xl shadow-[0_18px_45px_rgba(46,119,223,0.22),inset_0_1px_0_rgba(255,255,255,0.65)] transition-[transform,left,top,box-shadow] duration-300 ease-out ${
        isDragging
          ? "scale-110 shadow-[0_28px_56px_rgba(46,119,223,0.28),inset_0_1px_0_rgba(255,255,255,0.72)]"
          : "active:scale-[0.97]"
      }`}
      style={{
        left: position.x,
        top: position.y,
        touchAction: "none",
      }}
      aria-label="Mở AI Duty Assistant"
    >
      <div className="absolute inset-[4px] rounded-full bg-gradient-to-br from-white/48 via-white/10 to-[#2e77df]/14" />
      <div className="relative flex flex-col items-center gap-0.5">
        <SparkleIcon />
        <span className="text-[11px] font-semibold leading-none">AI</span>
      </div>
    </button>
  )
}

export default function AdminLayout(){
  const { user: authUser, isOffline } = useAuth()
  const [user, setUser] = useState<any>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const toastShownRef = useRef(false)

  useEffect(() => {
    setUser((prev: any) => ({
      ...authUser,
      password_changed: prev?.password_changed,
    }))
  }, [authUser])

  useEffect(() => {
    if (!authUser || isOffline) return
    loadProfile()
  }, [authUser, isOffline])

  async function loadProfile() {
    try {
      const profile = await api.get("/account/profile")

      setUser({
        ...authUser,
        password_changed: profile.data.password_changed,
      })

      if (!profile.data.password_changed && !toastShownRef.current) {
        setShowChangePassword(true)
        toastShownRef.current = true
        toast("Bạn cần đổi mật khẩu trước khi tiếp tục", {
        })
      }
    } catch (err) {
      console.error(err)
    }
  }

  return(

    <RequireRole role="co_do">

      <Outlet context={{ user, setShowChangePassword }} />
      <CoDoFloatingAssistantFab />

      {showChangePassword && (
        <ChangePasswordModal
          role="co_do"
          onSuccess={() => {
            setShowChangePassword(false)
            loadProfile()
          }}
          canClose={user?.password_changed === true}
        />
      )}

    </RequireRole>

  )

}
