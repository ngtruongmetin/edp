import { useEffect, useState } from "react"

import { api } from "../api/api"
import DutyEvidencePanel from "./DutyEvidencePanel"
import RuleSelector, { type RuleType } from "./RuleSelector"
import SignatureDisplay from "./SignatureDisplay"
import { formatDutyStatus, formatRevisionAction, formatRevisionDetails } from "../utils/dutyFormat"
import { effectiveViolationScore, violationQuantityLabel } from "../utils/dutyViolations"

type Props = {
  sessionId: number
  onClose: () => void
  onSessionChanged?: (deleted: boolean) => void | Promise<void>
}

type Period = { subject: string; score: number }

export default function AdminDutySessionModal({ sessionId, onClose, onSessionChanged }: Props) {
  const [detail, setDetail] = useState<any>(null)
  const [rules, setRules] = useState<RuleType[]>([])
  const [password, setPassword] = useState("")
  const [signing, setSigning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [periods, setPeriods] = useState<Period[]>([])
  const [newRule, setNewRule] = useState<number | null>(null)
  const [newQuantity, setNewQuantity] = useState(1)
  const [newNote, setNewNote] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRule, setEditRule] = useState<number | null>(null)
  const [editQuantity, setEditQuantity] = useState(1)
  const [editNote, setEditNote] = useState("")

  async function notify(deleted = false) {
    await onSessionChanged?.(deleted)
  }

  async function load() {
    const [sessionResponse, rulesResponse] = await Promise.all([
      api.get(`/duty/admin/session/${sessionId}`),
      api.get<RuleType[]>("/rules/admin"),
    ])
    setDetail(sessionResponse.data)
    setRules(rulesResponse.data || [])
    const raw = sessionResponse.data?.session?.bonus_periods_json || "[]"
    try {
      const parsed = JSON.parse(raw)
      setPeriods(Array.isArray(parsed) ? parsed.map((item: unknown) => {
        if (item && typeof item === "object") {
          const value = item as { subject?: unknown; score?: unknown }
          return { subject: String(value.subject || "").trim() || "Tiết", score: Number(value.score) }
        }
        return { subject: "Tiết", score: Number(item) }
      }).filter((item: Period) => Number.isFinite(item.score)) : [])
    } catch {
      setPeriods([])
    }
  }

  useEffect(() => { void load().catch((error) => alert(error?.response?.data?.error || "Không thể tải chi tiết phiếu trực.")) }, [sessionId])

  async function sign() {
    if (!password.trim()) return alert("Vui lòng nhập mật khẩu quản trị")
    if (!confirm("Ký phiếu này bằng quyền quản trị?")) return
    try {
      setSigning(true)
      await api.post(`/duty/admin/session/${sessionId}/sign`, { admin_password: password })
      setPassword("")
      await load()
      await notify()
    } catch (error: any) {
      alert(error?.response?.data?.error === "Invalid password" ? "Mật khẩu quản trị không đúng" : error?.response?.data?.error || "Không thể ký")
    } finally { setSigning(false) }
  }

  async function removeSession() {
    if (!confirm("Xóa phiếu trực này?")) return
    try {
      await api.delete(`/duty/admin/session/${sessionId}`)
      await notify(true)
      onClose()
    } catch (error: any) { alert(error?.response?.data?.error || "Không thể xóa phiếu trực") }
  }

  async function savePeriods() {
    if (!detail?.session) return
    const valid = periods.filter((period) => Number.isFinite(period.score))
    const scores = valid.map((period) => period.score)
    try {
      setSaving(true)
      await api.post("/bonus/apply-day", {
        week_id: detail.session.week_id, class_name: detail.session.duty_class, date: detail.session.date,
        points: scores.reduce((total, score) => total + score, 0), min_score: scores.length ? Math.min(...scores) : null,
        all_above_9: scores.length > 0 && scores.every((score) => score >= 9), source: "admin_manual",
        session_id: detail.session.id, periods: valid,
      })
      await load(); await notify()
    } catch (error: any) { alert(error?.response?.data?.error || "Không thể lưu điểm") } finally { setSaving(false) }
  }

  async function addViolation() {
    if (!newRule) return alert("Vui lòng chọn lỗi")
    try {
      setSaving(true)
      await api.post("/duty/admin/violation", { session_id: sessionId, rule_id: newRule, quantity: newQuantity, note: newNote })
      setNewRule(null); setNewQuantity(1); setNewNote("")
      await load(); await notify()
    } catch (error: any) { alert(error?.response?.data?.error || "Không thể thêm lỗi") } finally { setSaving(false) }
  }

  async function saveViolation(id: number) {
    if (!editRule) return alert("Vui lòng chọn lỗi")
    try {
      setSaving(true)
      await api.put(`/duty/admin/violation/${id}`, { rule_id: editRule, quantity: editQuantity, note: editNote })
      setEditingId(null); await load(); await notify()
    } catch (error: any) { alert(error?.response?.data?.error || "Không thể lưu lỗi") } finally { setSaving(false) }
  }

  async function removeViolation(id: number) {
    if (!confirm("Xóa lỗi này?")) return
    try { setSaving(true); await api.delete(`/duty/admin/violation/${id}`); await load(); await notify() }
    catch (error: any) { alert(error?.response?.data?.error || "Không thể xóa lỗi") } finally { setSaving(false) }
  }

  const violations = detail?.violations || []
  const selectedRule = rules.find((rule) => rule.id === newRule)
  const violationScore = violations.reduce((total: number, violation: any) => total + effectiveViolationScore(violation), 0)
  const bonus = Number(detail?.session?.bonus_points || 0)

  const canClose = !signing && !saving

  return <div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
    onPointerDown={(event) => {
      if (canClose && event.target === event.currentTarget) onClose()
    }}
  >
    <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-hidden rounded-3xl bg-white p-5 shadow-2xl">
      <div className="flex items-center gap-2"><h2 className="text-base font-semibold text-gray-900">Chi tiết phiếu trực</h2><button type="button" disabled={!canClose} className="ml-auto rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50" onClick={onClose}>Đóng</button></div>
      {!detail ? <div className="mt-4 text-sm text-gray-600">Đang tải...</div> : <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pb-2">
        <section className="rounded-2xl bg-slate-50 p-4"><div className="text-sm font-semibold text-gray-900">{detail.session.red_class} trực {detail.session.duty_class}</div><div className="mt-1 flex items-center gap-2 text-xs text-gray-600">Ngày: {detail.session.date} | Trạng thái: {formatDutyStatus(detail.session.status)}<button type="button" className="ml-auto rounded-full bg-red-50 px-3 py-1 font-semibold text-red-700" onClick={() => void removeSession()}>Xóa phiếu</button></div>{detail.session.status !== "signed" && <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-blue-100"><div className="text-xs font-semibold text-gray-700">Ký phụ (Quản trị)</div><div className="mt-2 flex gap-2"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mật khẩu quản trị" className="min-w-0 flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><button type="button" disabled={signing} onClick={() => void sign()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{signing ? "Đang ký..." : "Ký"}</button></div></div>}</section>
        <section className="grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 ring-1 ring-blue-50"><div><div className="text-xs text-gray-500">Tổng điểm</div><div className={`mt-1 text-2xl font-semibold ${violationScore + bonus >= 0 ? "text-emerald-700" : "text-red-600"}`}>{violationScore + bonus}</div></div><div><div className="text-xs text-gray-500">Cộng sổ đầu bài</div><div className="mt-1 text-2xl font-semibold text-[#2e77df]">+{bonus}</div></div></section>
        <section className="rounded-2xl bg-white p-4 ring-1 ring-blue-50"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">Sổ đầu bài</h3><span className="text-xs text-gray-500">Tổng: {periods.reduce((total, period) => total + period.score, 0)}</span></div><div className="mt-3 space-y-2">{periods.map((period, index) => <div key={index} className="flex gap-2"><input value={period.subject} onChange={(event) => setPeriods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subject: event.target.value } : item))} className="min-w-0 flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><input type="number" value={period.score} onChange={(event) => setPeriods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, score: Number(event.target.value) } : item))} className="w-20 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><button type="button" onClick={() => setPeriods((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="px-2 text-xs text-red-600">Xóa</button></div>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPeriods((current) => [...current, { subject: "", score: 10 }])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Thêm tiết</button><button type="button" disabled={saving} onClick={() => void savePeriods()} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Lưu điểm</button></div></section>
        <section className="space-y-3"><h3 className="text-sm font-semibold text-gray-900">Vi phạm</h3><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><RuleSelector rules={rules} value={newRule} onChange={setNewRule} placeholder="Tìm và chọn lỗi vi phạm"/>{selectedRule && <p className="mt-2 text-xs text-slate-500">Tác động điểm: {selectedRule.score_delta}</p>}<div className="mt-3 flex gap-2"><input type="number" min={1} value={newQuantity} onChange={(event) => setNewQuantity(Math.max(1, Number(event.target.value) || 1))} className="w-20 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><input value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Ghi chú" className="min-w-0 flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><button type="button" disabled={saving || !newRule} onClick={() => void addViolation()} className="rounded-xl bg-[#2e77df] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Thêm lỗi</button></div></div>{violations.map((violation: any) => editingId === violation.id ? <div key={violation.id} className="rounded-2xl border border-blue-100 p-3"><select value={editRule ?? ""} onChange={(event) => setEditRule(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-xl border border-blue-100 px-3 py-2 text-sm"><option value="">Chọn lỗi</option>{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.category} - {rule.name}</option>)}</select><div className="mt-2 flex gap-2"><input type="number" min={1} value={editQuantity} onChange={(event) => setEditQuantity(Math.max(1, Number(event.target.value) || 1))} className="w-20 rounded-xl border border-blue-100 px-3 py-2 text-sm"/><input value={editNote} onChange={(event) => setEditNote(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm"/></div><div className="mt-2 flex gap-2"><button type="button" onClick={() => void saveViolation(violation.id)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Lưu</button><button type="button" onClick={() => setEditingId(null)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Hủy</button></div></div> : <div key={violation.id} className="rounded-2xl border border-blue-100 bg-white p-3"><div className="font-semibold text-gray-900">{violation.name}</div><div className="mt-1 text-xs text-gray-500">{violation.category} | {violationQuantityLabel(violation)} ({violation.score_delta})</div>{violation.note && <div className="mt-1 text-xs text-gray-600">Ghi chú: {violation.note}</div>}<div className="mt-2 flex gap-2"><button type="button" onClick={() => { setEditingId(violation.id); setEditRule(violation.rule_id); setEditQuantity(Number(violation.quantity || 1)); setEditNote(String(violation.note || "")) }} className="text-xs font-semibold text-[#2e77df]">Sửa</button><button type="button" disabled={saving} onClick={() => void removeViolation(violation.id)} className="text-xs font-semibold text-red-600">Xóa</button></div></div>)}</section>
        <section className="overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-blue-100">{detail.session.signature_svg ? <SignatureDisplay svg={detail.session.signature_svg}/> : <div className="flex h-32 items-center justify-center text-sm text-gray-500">Chưa có chữ ký</div>}</section>
        <DutyEvidencePanel sessionId={Number(detail.session.id)} readOnly />
        <section><h3 className="text-sm font-semibold text-gray-900">Lịch sử chỉnh sửa</h3><div className="mt-2 space-y-2">{detail.revisions?.length ? detail.revisions.map((revision: any) => <div key={revision.id} className="rounded-xl border border-blue-100 p-3 text-xs"><div className="text-gray-500">{revision.created_at}</div><div className="font-semibold text-gray-900">{formatRevisionAction(revision.action)}</div>{formatRevisionDetails(revision) && <div className="mt-1 text-gray-600">{formatRevisionDetails(revision)}</div>}</div>) : <div className="text-sm text-gray-500">Chưa có.</div>}</div></section>
        <section><h3 className="text-sm font-semibold text-gray-900">Lịch sử ký</h3><div className="mt-2 space-y-2">{detail.signatures?.length ? detail.signatures.map((signature: any) => <div key={signature.id} className="rounded-xl border border-blue-100 p-3 text-xs"><div className="text-gray-500">{signature.signed_at}</div>{signature.signature_svg ? <SignatureDisplay svg={signature.signature_svg} className="mt-2 max-h-32"/> : <div className="mt-2 text-gray-500">{signature.confirmation_method === "admin_override" ? "Admin override" : "Không có chữ ký"}</div>}</div>) : <div className="text-sm text-gray-500">Chưa có.</div>}</div></section>
      </div>}
    </div>
  </div>
}
