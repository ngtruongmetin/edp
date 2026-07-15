import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import RuleSelector, { type RuleType } from "../../components/RuleSelector"
import CameraCapture from "../../components/CameraCapture"

import toast from "react-hot-toast"
import { localISODate } from "../../utils/dateLocal"
import { usePageTitle } from "../../utils/usePageTitle"
import useKeyboardInsets from "../../utils/useKeyboardInsets"

type Violation = {
  id: number
  rule_id: number
  name: string
  quantity: number
  note: string
  score_delta: number
}

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

type Assignment = {
  red_class: string
  duty_class: string
}

export default function CodoDuty() {
  usePageTitle("EDP | Phiếu trực")
  useKeyboardInsets()
  const params = useParams()
  const routeSessionId = params.id ? Number(params.id) : null
  const navigate = useNavigate()

  const [time, setTime] = useState(new Date())

  const [loading, setLoading] = useState(true)
  const bootedRef = useRef(false)

  const [className, setClassName] = useState("")
  const [week, setWeek] = useState<Week | null>(null)
  const [dutyClass, setDutyClass] = useState<string | null>(null)

  const [session, setSession] = useState<any>(null)

  const [rules, setRules] = useState<RuleType[]>([])
  const [violations, setViolations] = useState<Violation[]>([])

  const [ruleId, setRuleId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [quantityInput, setQuantityInput] = useState("1")
  const [note, setNote] = useState("")

  const [showSign, setShowSign] = useState(false)
  const [pin, setPin] = useState("")
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  useEffect(() => {
    boot()

    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // When navigating between /co_do/duty and /co_do/duty/:id,
  // React may keep this component mounted, so we must reload/reset state on param change.
  useEffect(() => {
    if (!bootedRef.current) return
    ;(async () => {
      setLoading(true)
      try {
        if (routeSessionId) {
          await loadSessionById(routeSessionId)
        } else {
          setSession(null)
          setViolations([])
          await loadUserAndSchedule()
          await loadSession()
        }
      } catch (err) {
        console.error(err)
        toast.error("Không thể tải dữ liệu")
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId])

  async function boot() {
    try {
      await loadRules()
      await loadUser()

      if(routeSessionId){
        await loadSessionById(routeSessionId)
      }else{
        await loadUserAndSchedule()
        await loadSession()
      }
    } catch (err) {
      console.error(err)
      toast.error("Không thể tải dữ liệu")
    } finally {
      bootedRef.current = true
      setLoading(false)
    }
  }

  async function loadUser(){
    const me = await api.get("/auth/me")
    const cn = me.data.class_name as string
    setClassName(cn)
  }

  async function loadRules() {
    const res = await api.get("/rules")
    setRules(res.data)
  }

  async function loadUserAndSchedule() {
    const cn = className || (await api.get("/auth/me")).data.class_name
    const sch = await api.get("/schedule")

    setWeek(sch.data?.week || null)

    const row = (sch.data?.assignments || []).find(
      (a: Assignment) => a.red_class === cn,
    )

    setDutyClass(row ? row.duty_class : null)
  }

  async function loadSession() {
    const res = await api.get("/duty/current")

    if (res.data.session) {
      setSession(res.data.session)
      setViolations(res.data.violations || [])
      return
    }

    setSession(null)
    setViolations([])
  }

  async function loadSessionById(id:number){
    const res = await api.get(`/duty/my/session/${id}`)
    setSession(res.data.session)
    setViolations(res.data.violations || [])
    setDutyClass(res.data.session?.duty_class || null)
    setWeek(res.data.week || null)
  }

  async function addViolation() {
    if (!ruleId || !session) return

    await api.post("/duty/violation", {
      session_id: session.id,
      rule_id: ruleId,
      quantity,
      note,
    })

    setRuleId(null)
    setQuantity(1)
    setQuantityInput("1")
    setNote("")

    if(routeSessionId){
      await loadSessionById(routeSessionId)
    }else{
      await loadSession()
    }
  }

  async function removeViolation(id: number) {
    await api.delete(`/duty/violation/${id}`)
    if(routeSessionId){
      await loadSessionById(routeSessionId)
    }else{
      await loadSession()
    }
  }

  async function signDuty() {
    if (!session) return

    await api.post("/duty/sign", {
      session_id: session.id,
      pin,
      photo_data: photoData,
    })

    toast.success("Đã ký xác nhận")
    if(routeSessionId){
      await loadSessionById(routeSessionId)
    }else{
      await loadSession()
    }
  }

  function formatDate(d: Date) {
    const day = String(d.getDate()).padStart(2, "0")
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const year = d.getFullYear()

    return `${day}/${month}/${year}`
  }

  function formatTime(d: Date) {
    const h = String(d.getHours()).padStart(2, "0")
    const m = String(d.getMinutes()).padStart(2, "0")
    const s = String(d.getSeconds()).padStart(2, "0")

    return `${h}:${m}:${s}`
  }

  function formatDateISO(date: string) {
    if (!date) return ""
    const [y, m, d] = date.split("-")
    if (!y || !m || !d) return ""
    return `${d}/${m}/${y}`
  }

  // Must be local date (VN). Using toISOString() would use UTC and break around midnight.
  const todayISO = useMemo(() => localISODate(time), [time])
  const viewingDateISO = session?.date || todayISO
  const viewingToday = viewingDateISO === todayISO

  const signed = session?.status === "signed"
  const needsResign = !signed && !!session?.signature_signed_at

  const selectedRule = useMemo(
    () => (ruleId != null ? rules.find((r) => r.id === ruleId) : null),
    [ruleId, rules],
  )

  const totalScore = violations.reduce((sum, v) => {
    return sum + v.score_delta * v.quantity
  }, 0)
  const bonusPoints = Number(session?.bonus_points || 0)
  const totalWithBonus = totalScore + bonusPoints

  return (
    <div className="edp-mobile-shell flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-4 pb-28 space-y-4">
        <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2e77df] via-[#2b6fd0] to-[#1f5fc0] text-white shadow-[0_18px_42px_rgba(30,64,175,0.28)]">
          <div className="p-5">
            <div className="text-sm opacity-90">
              {routeSessionId
                ? `Phiếu trực ngày ${formatDateISO(viewingDateISO)}`
                : "Ca trực hôm nay"}
            </div>

            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <div className="text-4xl font-semibold tracking-tight tabular-nums">
                  {formatTime(time)}
                </div>
                <div className="mt-1 text-sm opacity-85">{formatDate(time)}</div>
              </div>
              <div className="rounded-2xl bg-white/12 px-4 py-3 text-right">
                <div className="text-[11px] uppercase tracking-[0.12em] opacity-75">
                  Lớp trực
                </div>
                <div className="mt-1 text-sm font-semibold">{dutyClass || "--"}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <div className="text-[11px] opacity-80">Lớp cờ đỏ</div>
                <div className="mt-0.5 text-lg font-semibold">{className || "--"}</div>
              </div>

              {week ? (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
                  Tuần {week.week_number}
                  <div className="mt-1 text-[11px] opacity-80">
                    {formatDateISO(week.start_date)} - {formatDateISO(week.end_date)}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm opacity-85">
                  Đang tải tuần
                </div>
              )}
            </div>

          </div>
        </div>

        {routeSessionId && !viewingToday && (
          <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-blue-50">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">
                Bạn đang xem phiếu ngày {formatDateISO(viewingDateISO)}
              </div>
              <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                Phiếu khác ngày
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => navigate("/co_do/duty", { replace: true })}
                className="min-h-12 rounded-2xl bg-[#2e77df] px-4 py-3 text-sm font-semibold text-white shadow-sm active:scale-[0.98]"
              >
                Về phiếu hôm nay
              </button>
              <button
                onClick={() => navigate("/co_do/dashboard")}
                className="min-h-12 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 active:scale-[0.98]"
              >
                Về Dashboard
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-32 rounded-full bg-slate-100" />
              <div className="h-5 w-48 rounded-full bg-slate-100" />
              <div className="h-28 rounded-2xl bg-slate-100" />
            </div>
          </div>
        )}

        {!loading && !session && (
          <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="text-sm font-semibold text-gray-900">Trạng thái</div>
            <div className="mt-1 text-sm text-gray-600">
              {routeSessionId
                ? "Không tìm thấy phiếu trực này."
                : <>Chưa bắt đầu ca trực. Vui lòng bấm <b>Bắt đầu trực</b> từ Dashboard để tạo phiếu cho ngày hôm nay.</>
              }
            </div>
          </div>
        )}

        {session && (
          <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">Vi phạm</div>
              {signed ? (
                <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Đã ký
                </span>
              ) : (
                <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                  Nháp
                </span>
              )}
            </div>

            {needsResign && (
              <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
                Phiếu đã ký trước đó nhưng vừa được chỉnh sửa, cần chụp ảnh và ký lại.
              </div>
            )}

            <div className="mt-3 space-y-3">
              <RuleSelector rules={rules} value={ruleId} onChange={setRuleId} />

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                  <div className="text-[11px] text-gray-500">Số lần</div>
                    <input
                      type="number"
                      min={1}
                      value={quantityInput}
                      onChange={(e) => {
                        setQuantityInput(e.target.value)
                      }}
                      onBlur={() => {
                        const val = Number(quantityInput)

                        if (!quantityInput || isNaN(val) || val < 1) {
                          setQuantity(1)
                          setQuantityInput("1")
                        } else {
                          setQuantity(val)
                          setQuantityInput(String(val))
                        }
                      }}
                      className="mt-1 w-full bg-transparent text-[16px] font-semibold text-gray-900 outline-none"
                    />
                </div>

                <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                  <div className="text-[11px] text-gray-500">Điểm</div>
                  <div className="mt-1 text-[15px] font-semibold text-gray-900">
                    {selectedRule ? selectedRule.score_delta : "--"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] text-gray-500">Ghi chú</div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full bg-transparent text-[16px] text-gray-900 outline-none"
                  placeholder="Có thể ghi hoặc không"
                  onFocus={(e) => {
                    e.currentTarget.scrollIntoView({
                      block: "center",
                      behavior: "smooth",
                    })
                  }}
                />
              </div>

              <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem+var(--edp-keyboard-offset,0px))] z-20 rounded-[24px] bg-white/95 pt-3 backdrop-blur">
                <button
                  onClick={async () => {
                    try {
                      if (!ruleId) {
                        toast.error("Chọn lỗi vi phạm")
                        return
                      }
                      await addViolation()
                      toast.success("Đã thêm vi phạm")
                    } catch (err) {
                      console.error(err)
                      toast.error("Không thể thêm vi phạm")
                    }
                  }}
                  className="w-full min-h-14 rounded-2xl bg-[#2e77df] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
                >
                  Thêm vi phạm
                </button>
              </div>
            </div>
          </div>
        )}

        {session && (
          <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">
                Danh sách vi phạm
              </div>
              <div className="ml-auto text-xs text-gray-500">
                {violations.length} mục
              </div>
            </div>

            {violations.length === 0 && (
              <div className="mt-3 rounded-2xl border border-dashed border-blue-100 bg-blue-50/30 px-4 py-4 text-sm text-gray-600">
                Chưa có vi phạm nào được ghi nhận.
              </div>
            )}

            <div className="mt-3 space-y-2">
              {violations.map((v) => (
                <div key={v.id} className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-gray-900">
                        {v.name}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        x{v.quantity} ({v.score_delta} mỗi lần)
                      </div>
                      {v.note ? (
                        <div className="mt-1 text-xs text-gray-600">
                          Ghi chú: {v.note}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
                        {v.score_delta * v.quantity}
                      </div>

                      <button
                        onClick={async () => {
                          try {
                            await removeViolation(v.id)
                            toast.success("Đã xóa")
                          } catch (err) {
                            console.error(err)
                            toast.error("Không thể xóa")
                          }
                        }}
                        className="text-xs font-semibold text-red-600"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {session && (
          <div className="rounded-[28px] bg-white p-5 text-center shadow-sm ring-1 ring-blue-50">
            <div className="text-sm text-gray-600">Tổng điểm</div>
            <div
              className={`mt-1 text-4xl font-semibold ${
                totalWithBonus >= 0 ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {totalWithBonus > 0 ? `+${totalWithBonus}` : String(totalWithBonus)}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] text-gray-500">Vi phạm</div>
                <div className="mt-0.5 text-sm font-semibold text-gray-900">
                  {totalScore > 0 ? `+${totalScore}` : String(totalScore)}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] text-gray-500">Cộng sổ đầu bài</div>
                <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">
                  +{bonusPoints}
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                setShowSign(true)
              }}
              className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition"
            >
              {signed ? "Ký lại" : "Ký xác nhận"}
            </button>

            {signed && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-gray-500">
                  Đã ký xác nhận lúc {session?.signed_at || "--"}
                </div>
                {session?.signature_photo_path ? (
                  <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100">
                    <img
                      src={session.signature_photo_path}
                      alt="signature"
                      className="w-full"
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {showSign && session && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                if (!signing) setShowSign(false)
              }}
            />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl"
                 style={{
                   maxHeight: "calc(92dvh - var(--edp-keyboard-offset, 0px))",
                   paddingBottom:
                     "calc(1.25rem + env(safe-area-inset-bottom) + var(--edp-keyboard-offset, 0px))",
                 }}>
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold text-gray-900">
                  Ký phiếu trực
                </div>
                <button
                  className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                  onClick={() => {
                    if (!signing) setShowSign(false)
                  }}
                >
                  Đóng
                </button>
              </div>

              <div className="mt-2 text-sm leading-6 text-gray-600">
                Nhập PIN Ban cán sự của lớp và chụp ảnh rõ mặt để xác nhận.
              </div>

              <div className="mt-4 max-h-[calc(92dvh-9rem)] space-y-3 overflow-y-auto pr-1">
                <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                  <div className="text-[11px] text-gray-500">
                    PIN Ban cán sự lớp {session?.duty_class}
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 6)
                      setPin(digits)
                    }}
                    className="mt-1 w-full bg-transparent text-[16px] font-semibold tracking-widest text-gray-900 outline-none"
                    placeholder="Nhập PIN"
                    onFocus={(e) => {
                      e.currentTarget.scrollIntoView({
                        block: "center",
                        behavior: "smooth",
                      })
                    }}
                  />
                </div>

                <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                  <div className="text-[11px] text-gray-500">Ảnh xác nhận</div>
                  <div className="mt-3">
                    <CameraCapture value={photoData} onChange={setPhotoData} />
                  </div>
                </div>

                <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+var(--edp-keyboard-offset,0px))] rounded-[24px] bg-gradient-to-t from-white via-white to-white/90 pt-3">
                  <button
                    disabled={signing}
                    onClick={async () => {
                      if (!pin.trim()) {
                        toast.error("Nhập PIN")
                        return
                      }
                      if (pin.trim().length !== 6) {
                        toast.error("PIN gồm 6 chữ số")
                        return
                      }

                      setSigning(true)
                      try {
                        await signDuty()
                        setShowSign(false)
                        setPin("")
                        setPhotoData(null)
                      } catch (err: any) {
                        console.error(err)
                        const msg =
                          err?.response?.data?.error === "Invalid pin"
                            ? "PIN không đúng"
                            : "Không thể ký xác nhận"
                        toast.error(msg)
                      } finally {
                        setSigning(false)
                      }
                    }}
                    className="w-full min-h-14 rounded-2xl bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {signing ? "Đang ký..." : "Xác nhận ký"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
