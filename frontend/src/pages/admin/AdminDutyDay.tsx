import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { formatDutyStatus, formatRevisionAction } from "../../utils/dutyFormat"
import { usePageTitle } from "../../utils/usePageTitle"

type SessionRow = {
  id: number
  week_id: number
  date: string
  red_class: string
  duty_class: string
  status: string
  signed_at: string | null
  signature_photo_path: string | null
  total_score: number
}

type Detail = {
  session: any
  violations: Array<{
    id: number
    rule_id: number
    quantity: number
    note: string
    category: string
    name: string
    score_delta: number
  }>
  revisions?: Array<{
    id: number
    action: string
    created_at: string
  }>
  signatures?: Array<{
    id: number
    photo_path: string
    signed_at: string
  }>
}

export default function AdminDutyDay() {
  usePageTitle("EDP | Phiếu trực theo ngày")
  const [date, setDate] = useState("")
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRow[]>([])

  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load(targetDate?: string) {
    setLoading(true)
    try {
      const res = await api.get("/duty/admin/day", {
        params: targetDate ? { date: targetDate } : undefined,
      })
      setDate(res.data.date)
      setSessions(res.data.sessions || [])
    } finally {
      setLoading(false)
    }
  }

  async function openDetail(id: number) {
    setDetailId(id)
    setDetail(null)
    const res = await api.get(`/duty/admin/session/${id}`)
    setDetail(res.data)
  }

  async function deleteSession(id: number) {
    if (!confirm("Xóa phiếu trực này?")) return
    await api.delete(`/duty/admin/session/${id}`)
    setDetailId(null)
    setDetail(null)
    await load(date)
  }

  function badge(status: string) {
    if (status === "signed") {
      return (
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          Đã ký
        </span>
      )
    }
    return (
      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
        Nháp
      </span>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Phiếu trực theo ngày</span>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div>
              <div className="text-xl font-semibold text-gray-900">Phiếu trực</div>
              <div className="text-sm text-gray-600">Theo ngày</div>
            </div>

            <div className="sm:ml-auto flex items-center gap-3">
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  const v = e.target.value
                  setDate(v)
                  load(v)
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              />
              <button
                onClick={() => load(date)}
                className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
              >
                Tải lại
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-blue-50">
            <div className="text-sm text-gray-600">Đang tải dữ liệu...</div>
          </div>
        ) : (
          <div className="rounded-3xl bg-white p-0 shadow-sm ring-1 ring-blue-50 overflow-hidden">
            <div className="px-5 py-4 flex items-center">
              <div className="text-sm font-semibold text-gray-900">
                {sessions.length} phiếu
              </div>
              <Link
                to="/admin/duty/week"
                className="ml-auto text-sm font-semibold text-[#2e77df]"
              >
                Xem theo tuần
              </Link>
            </div>

            {sessions.length === 0 ? (
              <div className="px-5 pb-6 text-sm text-gray-600">
                Không có phiếu trực trong ngày này.
              </div>
            ) : (
              <div className="divide-y divide-blue-50">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    className="w-full text-left px-5 py-4 hover:bg-slate-50 transition"
                    onClick={() => openDetail(s.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-gray-900">
                          {s.red_class} trực {s.duty_class}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          Tổng điểm:{" "}
                          <span className="font-semibold text-red-600">
                            {s.total_score}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        {badge(s.status)}
                        {s.signature_photo_path ? (
                          <span className="text-[11px] text-gray-500">
                            Có ảnh
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {detailId != null && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                setDetailId(null)
                setDetail(null)
              }}
            />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl md:left-1/2 md:top-1/2 md:bottom-auto md:inset-x-auto md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-xl md:rounded-3xl">
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold text-gray-900">
                  Chi tiết phiếu
                </div>
                <button
                  className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
                  onClick={() => {
                    setDetailId(null)
                    setDetail(null)
                  }}
                >
                  Đóng
                </button>
              </div>

              {!detail ? (
                <div className="mt-3 text-sm text-gray-600">Đang tải...</div>
              ) : (
                <div className="mt-3 max-h-[70vh] overflow-y-auto space-y-4 pb-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">
                      {detail.session.red_class} trực {detail.session.duty_class}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="text-xs text-gray-600">
                        Trạng thái: {formatDutyStatus(detail.session.status)}
                      </div>
                      <button
                        onClick={() => deleteSession(detail.session.id)}
                        className="ml-auto rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                      >
                        Xóa phiếu
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
                    {detail.session.signature_photo_path ? (
                      <img
                        src={detail.session.signature_photo_path}
                        alt="signature"
                        className="w-full"
                      />
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-500">
                        Chưa có ảnh ký
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-900">
                      Vi phạm
                    </div>
                    {detail.violations.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        Không có vi phạm.
                      </div>
                    ) : (
                      detail.violations.map((v) => (
                        <div
                          key={v.id}
                          className="rounded-2xl border border-blue-100 bg-white px-4 py-3"
                        >
                          <div className="text-[15px] font-semibold text-gray-900">
                            {v.name}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {v.category} | x{v.quantity} ({v.score_delta})
                          </div>
                          {v.note ? (
                            <div className="mt-1 text-xs text-gray-600">
                              Ghi chú: {v.note}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-900">
                      Lịch sử chỉnh sửa
                    </div>
                    {detail.revisions?.length ? (
                      detail.revisions.map((r: any) => (
                        <div
                          key={r.id}
                          className="rounded-2xl border border-blue-100 bg-white px-4 py-3"
                        >
                          <div className="text-xs text-gray-500">{r.created_at}</div>
                          <div className="text-sm font-semibold text-gray-900">
                            {formatRevisionAction(r.action)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-600">Chưa có.</div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-900">
                      Lịch sử ký
                    </div>
                    {detail.signatures?.length ? (
                      detail.signatures.map((s: any) => (
                        <div
                          key={s.id}
                          className="rounded-2xl border border-blue-100 bg-white px-4 py-3"
                        >
                          <div className="text-xs text-gray-500">{s.signed_at}</div>
                          {s.photo_path ? (
                            <div className="mt-2 overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
                              <img src={s.photo_path} className="w-full" />
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-600">Chưa có.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
