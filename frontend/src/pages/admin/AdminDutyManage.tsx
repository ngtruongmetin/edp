import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../../api/api"

import Navbar from "../../components/Navbar"
import Footer from "../../components/Footer"
import { formatDutyStatus, formatRevisionAction } from "../../utils/dutyFormat"
import { localISODate } from "../../utils/dateLocal"
import { usePageTitle } from "../../utils/usePageTitle"

type Week = {
  id: number
  week_number: number
  start_date: string
  end_date: string
}

type SessionRow = {
  id: number
  date: string
  red_class: string
  duty_class: string
  status: string
  signed_at: string | null
  signature_photo_path: string | null
  violation_score: number
  bonus_points: number
  total_score: number
}

export default function AdminDutyManage() {
  usePageTitle("EDP | Quản lý phiếu trực")
  const [weeks, setWeeks] = useState<Week[]>([])
  const [weekId, setWeekId] = useState<number | null>(null)
  const [closedAt, setClosedAt] = useState<string | null>(null)

  const [date, setDate] = useState("") // "" = all days
  const [grade, setGrade] = useState("") // "" = all grades

  const [sortKey, setSortKey] = useState<"date" | "red_class" | "duty_class" | "total_score">(
    "date",
  )
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRow[]>([])

  const [uploadGrade, setUploadGrade] = useState("10")
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<Record<
    string,
    { upload_count: number; last_uploaded: string | null }
  >>({})
  type MissingLog = {
    grade: number | null
    class_name: string
    day_name: string
    date: string
    period: number
    subject: string
    session: string
    status: string
  }

  const [missingLogs, setMissingLogs] = useState<MissingLog[]>([])

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showSigned, setShowSigned] = useState(true)
  const [showDraft, setShowDraft] = useState(true)

  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [adminSignPassword, setAdminSignPassword] = useState("")
  const [adminSigning, setAdminSigning] = useState(false)

  const [bonusPeriods, setBonusPeriods] = useState<Array<{ subject: string; score: number }>>([])
  const [bonusSaving, setBonusSaving] = useState(false)
  const [rules, setRules] = useState<any[]>([])
  const [newViolationRule, setNewViolationRule] = useState<number | "">("")
  const [newViolationQty, setNewViolationQty] = useState(1)
  const [newViolationNote, setNewViolationNote] = useState("")
  const [editingViolationId, setEditingViolationId] = useState<number | null>(null)
  const [editViolationRule, setEditViolationRule] = useState<number | "">("")
  const [editViolationQty, setEditViolationQty] = useState(1)
  const [editViolationNote, setEditViolationNote] = useState("")
  const [violationSaving, setViolationSaving] = useState(false)

  const today = useMemo(() => localISODate(new Date()), [])

  useEffect(() => {
    boot()
  }, [])

  useEffect(() => {
    loadRules()
  }, [])

  useEffect(() => {
    if (!detail?.session) return
    let arr: Array<{ subject: string; score: number }> = []
    try {
      const raw = detail.session.bonus_periods_json || "[]"
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        arr = parsed
          .map((p) => {
            if (p && typeof p === "object") {
              const score = Number(p.score)
              if (!Number.isFinite(score)) return null
              const subject = String(p.subject || "").trim() || "Tiết"
              return { subject, score }
            }
            const score = Number(p)
            if (!Number.isFinite(score)) return null
            return { subject: "Tiết", score }
          })
          .filter((p): p is { subject: string; score: number } => p !== null)
      }
    } catch {
      arr = []
    }
    setBonusPeriods(arr)
  }, [detail?.session?.id])

  function parseClassName(name: string) {
    const g = parseInt(name, 10) || 0
    const aPos = name.indexOf("A")
    const num = aPos >= 0 ? parseInt(name.slice(aPos + 1), 10) || 0 : 0
    return { g, num, name }
  }

  async function boot() {
    setLoading(true)
    try {
      const w = await api.get("/schedule/admin")
      const weekList: Week[] = w.data || []
      setWeeks(weekList)

      const current = weekList.find((x) => x.start_date <= today && x.end_date >= today)
      const defaultWeekId = current?.id ?? (weekList.length ? weekList[0].id : null)
      setWeekId(defaultWeekId)

      if (defaultWeekId) {
        setDate("") // default: show all days
        setGrade("")
        await Promise.all([
          load(defaultWeekId, "", ""),
          loadSummary(defaultWeekId),
          loadUploadStatus(defaultWeekId),
        ])
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadSummary(id: number) {
    try {
      const res = await api.get(`/duty/admin/week/${id}/summary`)
      setClosedAt(res.data.closed_at || null)
    } catch {
      setClosedAt(null)
    }
  }

  async function loadUploadStatus(id: number) {
    try {
      const res = await api.get("/bonus/admin/upload-status", {
        params: { week_id: id },
      })
      const rows = res.data.grades || []
      const map: Record<string, { upload_count: number; last_uploaded: string | null }> = {}
      rows.forEach((r: any) => {
        map[String(r.grade)] = {
          upload_count: Number(r.upload_count || 0),
          last_uploaded: r.last_uploaded || null,
        }
      })
      setUploadStatus(map)
    } catch {
      setUploadStatus({})
    }
  }

  async function load(id: number, d: string, g: string) {
    setLoading(true)
    try {
      const res = await api.get("/duty/admin/query", {
        params: {
          week_id: id,
          date: d || undefined,
          grade: g || undefined,
        },
      })
      setSessions(res.data.sessions || [])
    } finally {
      setLoading(false)
    }
  }

  async function openDetail(id: number) {
    setDetailId(id)
    setDetail(null)
    setAdminSignPassword("")
    const res = await api.get(`/duty/admin/session/${id}`)
    setDetail(res.data)
    setEditingViolationId(null)
  }

  async function loadRules() {
    try {
      const res = await api.get("/rules/admin")
      setRules(res.data || [])
    } catch {}
  }

  function arrayBufferToBase64(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf)
    let binary = ""
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  async function adminSignSession(id: number) {
    if (!adminSignPassword.trim()) {
      alert("Vui lòng nhập mật khẩu quản trị")
      return
    }
    if (!confirm("Ký phiếu này bằng quyền quản trị?")) return

    setAdminSigning(true)
    try {
      await api.post(`/duty/admin/session/${id}/sign`, {
        admin_password: adminSignPassword,
      })
      setAdminSignPassword("")
      await openDetail(id)
      if (weekId) await load(weekId, date, grade)
    } catch (err: any) {
      const msg =
        err?.response?.data?.error === "Invalid password"
          ? "Mật khẩu quản trị không đúng"
          : err?.response?.data?.error || "Không thể ký"
      alert(msg)
    } finally {
      setAdminSigning(false)
    }
  }

  async function deleteSession(id: number) {
    if (!confirm("Xóa phiếu trực này?")) return
    await api.delete(`/duty/admin/session/${id}`)
    setDetailId(null)
    setDetail(null)
    if (weekId) await load(weekId, date, grade)
  }

  async function addViolation() {
    if (!detail?.session) return
    if (!newViolationRule) {
      alert("Vui lòng chọn lỗi")
      return
    }
    setViolationSaving(true)
    try {
      await api.post("/duty/admin/violation", {
        session_id: detail.session.id,
        rule_id: newViolationRule,
        quantity: newViolationQty,
        note: newViolationNote,
      })
      setNewViolationRule("")
      setNewViolationQty(1)
      setNewViolationNote("")
      await openDetail(detail.session.id)
      if (weekId) await load(weekId, date, grade)
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể thêm lỗi"
      alert(msg)
    } finally {
      setViolationSaving(false)
    }
  }

  function startEditViolation(v: any) {
    setEditingViolationId(v.id)
    setEditViolationRule(v.rule_id || "")
    setEditViolationQty(Number(v.quantity || 1))
    setEditViolationNote(String(v.note || ""))
  }

  async function saveEditViolation(id: number) {
    if (!editViolationRule) {
      alert("Vui lòng chọn lỗi")
      return
    }
    setViolationSaving(true)
    try {
      await api.put(`/duty/admin/violation/${id}`, {
        rule_id: editViolationRule,
        quantity: editViolationQty,
        note: editViolationNote,
      })
      setEditingViolationId(null)
      await openDetail(detail.session.id)
      if (weekId) await load(weekId, date, grade)
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể lưu lỗi"
      alert(msg)
    } finally {
      setViolationSaving(false)
    }
  }

  async function removeViolation(id: number) {
    if (!confirm("Xóa lỗi này?")) return
    setViolationSaving(true)
    try {
      await api.delete(`/duty/admin/violation/${id}`)
      await openDetail(detail.session.id)
      if (weekId) await load(weekId, date, grade)
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể xóa lỗi"
      alert(msg)
    } finally {
      setViolationSaving(false)
    }
  }

  async function uploadZipFiles() {
    if (!weekId) return
    if (uploadFiles.length === 0) {
      alert("Vui lòng chọn file zip")
      return
    }
    if (uploadFiles.length > 2) {
      alert("Chỉ được chọn tối đa 2 file zip")
      return
    }
    setUploading(true)
    setMissingLogs([])
    try {
      const allMissing: MissingLog[] = []
      for (const f of uploadFiles) {
        const ab = await f.arrayBuffer()
        const base64 = arrayBufferToBase64(ab)
        const res = await api.post("/bonus/admin/upload-zip", {
          week_id: weekId,
          grade: uploadGrade,
          file_data: base64,
          file_name: f.name,
        })
        if (Array.isArray(res.data?.missing_logs)) {
          allMissing.push(...res.data.missing_logs)
        }
        const msg = `Đã xử lý ${res.data.processed_files} file, áp dụng ${res.data.applied_days} ngày`
        alert(msg)
      }
      setUploadFiles([])
      setMissingLogs(allMissing)
      await Promise.all([loadUploadStatus(weekId), load(weekId, date, grade)])
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể upload"
      alert(msg)
    } finally {
      setUploading(false)
    }
  }

  function formatMissingLog(x: MissingLog) {
    const grade = x.grade ? `Khối ${x.grade}` : "Khối"
    const cls = x.class_name || ""
    const day = x.day_name || ""
    const date = x.date || ""
    const period = x.period ? `Tiết ${x.period}` : "Tiết"
    const subject = x.subject || ""
    const session = x.session || ""
    const status = x.status || "Chưa nhập sổ đầu bài"
    return `${grade} | ${cls} | ${day} | ${date} | ${period} | ${subject} | ${session} | ${status}`
  }

  function copyMissingLogs() {
    if (missingLogs.length === 0) return
    const text = missingLogs.map(formatMissingLog).join("\n")
    navigator.clipboard.writeText(text).then(
      () => alert("Đã sao chép danh sách chưa ký"),
      () => window.prompt("Sao chép danh sách bên dưới:", text),
    )
  }

  function downloadMissingLogs() {
    if (missingLogs.length === 0 || !weekId) return
    api
      .post(
        "/bonus/admin/missing-logs/export",
        { week_id: weekId, grade: uploadGrade, logs: missingLogs },
        { responseType: "blob" },
      )
      .then((res) => {
        const url = URL.createObjectURL(res.data)
        const a = document.createElement("a")
        a.href = url
        a.download = `TrangThaiSDBK${uploadGrade || "xx"}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => {
        alert("Không thể xuất Excel")
      })
  }

  async function saveBonusPeriods() {
    if (!detail?.session) return
    const valid = bonusPeriods.filter((p) => Number.isFinite(p.score))
    const scores = valid.map((p) => p.score)
    const total = scores.reduce((s, x) => s + x, 0)
    const minScore = scores.length ? Math.min(...scores) : null
    const allAbove9 = scores.length ? scores.every((x) => x >= 9) : false
    setBonusSaving(true)
    try {
      await api.post("/bonus/apply-day", {
        week_id: detail.session.week_id,
        class_name: detail.session.duty_class,
        date: detail.session.date,
        points: total,
        min_score: minScore,
        all_above_9: allAbove9,
        source: "admin_manual",
        session_id: detail.session.id,
        periods: valid,
      })
      await openDetail(detail.session.id)
      if (weekId) await load(weekId, date, grade)
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Không thể lưu điểm"
      alert(msg)
    } finally {
      setBonusSaving(false)
    }
  }
  async function closeWeek() {
    if (!weekId) return
    if (missingGrades.length > 0) {
      alert(`Chưa upload sổ đầu bài cho khối ${missingGrades.join(", ")}`)
      return
    }
    const stats = await api.get(`/duty/admin/week/${weekId}/stats`)
    const drafts = Number(stats.data.draft_count || 0)
    const msg =
      drafts > 0
        ? `Tuần này còn ${drafts} phiếu chưa ký. Phiếu nháp sẽ không được tính. Vẫn tổng kết và khóa tuần?`
        : "Tổng kết tuần này và khóa chỉnh sửa?"
    if (!confirm(msg)) return
    await api.post(`/duty/admin/week/${weekId}/close`)
    await loadSummary(weekId)
  }

  async function reopenWeek() {
    if (!weekId) return
    if (!confirm("Mở khóa tuần này (cho phép chỉnh sửa lại)?")) return
    await api.post(`/duty/admin/week/${weekId}/reopen`)
    await loadSummary(weekId)
  }

  function formatDateISO(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-")
    return `${d}/${m}/${y}`
  }

  function weekday(dateStr: string) {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-").map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    return dt.toLocaleDateString("vi-VN", { weekday: "short" })
  }

  const selectedWeek =
    weekId != null ? weeks.find((w) => w.id === weekId) || null : null

  const missingGrades = ["10", "11", "12"].filter(
    (g) => !(uploadStatus[g]?.upload_count > 0),
  )
  const canCloseWeek = !!weekId && missingGrades.length === 0

  function enumerateWeekDays(w: Week | null) {
    if (!w?.start_date || !w?.end_date) return []
    const start = new Date(w.start_date + "T00:00:00")
    const end = new Date(w.end_date + "T00:00:00")
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
    const out: string[] = []
    const d = new Date(start)
    while (d.getTime() <= end.getTime()) {
      out.push(localISODate(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }

  const weekDays = useMemo(
    () => enumerateWeekDays(selectedWeek),
    [selectedWeek?.id],
  )

  function clickSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
      return
    }
    setSortKey(key)
    setSortDir(key === "date" ? "desc" : "asc")
  }

  const sortedSessions = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    const arr = [...sessions]
    arr.sort((a: any, b: any) => {
      if (sortKey === "date") return dir * String(a.date).localeCompare(String(b.date))
      if (sortKey === "total_score") return dir * (Number(a.total_score) - Number(b.total_score))
      if (sortKey === "red_class") {
        const aa = parseClassName(String(a.red_class || ""))
        const bb = parseClassName(String(b.red_class || ""))
        if (aa.g !== bb.g) return dir * (aa.g - bb.g)
        if (aa.num !== bb.num) return dir * (aa.num - bb.num)
        return dir * aa.name.localeCompare(bb.name)
      }
      if (sortKey === "duty_class") {
        const aa = parseClassName(String(a.duty_class || ""))
        const bb = parseClassName(String(b.duty_class || ""))
        if (aa.g !== bb.g) return dir * (aa.g - bb.g)
        if (aa.num !== bb.num) return dir * (aa.num - bb.num)
        return dir * aa.name.localeCompare(bb.name)
      }
      return 0
    })
    return arr
  }, [sessions, sortKey, sortDir])

  const visibleSessions = useMemo(() => {
    return sortedSessions.filter((s) => {
      if (s.status === "signed") return showSigned
      return showDraft
    })
  }, [sortedSessions, showSigned, showDraft])

  const visibleIds = useMemo(() => visibleSessions.map((s) => s.id), [visibleSessions])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id))

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => visibleIds.includes(id)))
  }, [visibleIds.join(",")])

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectAllVisible() {
    setSelectedIds(visibleIds)
  }

  function clearSelected() {
    setSelectedIds([])
  }

  async function adminSignSelected() {
    if (selectedIds.length === 0) {
      alert("Chưa chọn phiếu nào")
      return
    }
    if (!adminSignPassword.trim()) {
      alert("Vui lòng nhập mật khẩu admin")
      return
    }
    if (!confirm(`Ký ${selectedIds.length} phiếu đã chọn?`)) return
    setAdminSigning(true)
    let failed = 0
    try {
      for (const id of selectedIds) {
        const sess = sessions.find((s) => s.id === id)
        if (sess?.status === "signed") continue
        try {
          await api.post(`/duty/admin/session/${id}/sign`, {
            admin_password: adminSignPassword,
          })
        } catch {
          failed += 1
        }
      }
      if (failed > 0) {
        alert(`Không thể ký ${failed} phiếu`)
      }
      setAdminSignPassword("")
      if (weekId) await load(weekId, date, grade)
      clearSelected()
    } finally {
      setAdminSigning(false)
    }
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) {
      alert("Chưa chọn phiếu nào")
      return
    }
    if (!confirm(`Xóa ${selectedIds.length} phiếu đã chọn?`)) return
    let failed = 0
    for (const id of selectedIds) {
      try {
        await api.delete(`/duty/admin/session/${id}`)
      } catch {
        failed += 1
      }
    }
    if (failed > 0) {
      alert(`Không thể xóa ${failed} phiếu`)
    }
    if (weekId) await load(weekId, date, grade)
    clearSelected()
  }

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 pt-6 pb-10 space-y-5">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Quản lý phiếu trực</span>
        </div>

        <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-gray-900">Phiếu trực</div>
              <div className="mt-1 text-sm text-gray-600">
                Lọc theo tuần, ngày và lớp trực (theo khối)
              </div>
              {selectedWeek ? (
                <div className="mt-1 text-xs text-gray-500">
                  Tuần {selectedWeek.week_number} ({formatDateISO(selectedWeek.start_date)} -{" "}
                  {formatDateISO(selectedWeek.end_date)}){" "}
                  {closedAt ? `| Đã tổng kết: ${closedAt}` : "| Chưa tổng kết"}
                </div>
              ) : null}
            </div>

            <div className="lg:ml-auto grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
              <select
                value={weekId ?? ""}
                onChange={async (e) => {
                  const id = Number(e.target.value)
                  setWeekId(id)
                  setDate("")
                  await Promise.all([load(id, "", grade), loadSummary(id), loadUploadStatus(id)])
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    Tuần {w.week_number} ({formatDateISO(w.start_date)} - {formatDateISO(w.end_date)})
                  </option>
                ))}
              </select>

              <select
                value={date}
                onChange={async (e) => {
                  const v = e.target.value
                  setDate(v)
                  if (weekId) await load(weekId, v, grade)
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Tất cả các ngày</option>
                {weekDays.map((d) => (
                  <option key={d} value={d}>
                    {weekday(d)} {formatDateISO(d)}
                  </option>
                ))}
              </select>

              <select
                value={grade}
                onChange={async (e) => {
                  const v = e.target.value
                  setGrade(v)
                  if (weekId) await load(weekId, date, v)
                }}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="">Tất cả khối</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <div className="text-sm font-semibold text-gray-900">
              Upload sổ đầu bài theo khối (file .zip)
            </div>
            <div className="mt-2 grid grid-cols-1 lg:grid-cols-[140px_1fr_160px] gap-3">
              <select
                value={uploadGrade}
                onChange={(e) => setUploadGrade(e.target.value)}
                className="rounded-2xl border border-blue-100 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-[#2e77df]"
              >
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>

              <div className="w-full">
                <label className="inline-flex h-11 w-full cursor-pointer items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-slate-50">
                  <span>Chọn file .zip</span>
                  <span className="text-xs text-gray-400">Tối đa 2 file</span>
                  <input
                    type="file"
                    multiple
                    accept=".zip"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || [])
                      setUploadFiles(files)
                    }}
                    className="hidden"
                  />
                </label>
                <div className="mt-2 text-xs text-gray-500">
                  {uploadFiles.length > 0
                    ? uploadFiles.map((f) => f.name).join(", ")
                    : "Chưa chọn file"}
                </div>
              </div>

              <button
                onClick={uploadZipFiles}
                disabled={uploading || !weekId}
                className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {uploading ? "Đang tải lên..." : "Tải tệp zip"}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
              {["10", "11", "12"].map((g) => {
                const row = uploadStatus[g]
                const ok = row?.upload_count > 0
                return (
                  <div
                    key={g}
                    className={`rounded-full px-3 py-1 ${
                      ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    Khối {g}: {ok ? `Đã upload` : "Chưa upload"}
                  </div>
                )
              })}
              {!canCloseWeek ? (
                <div className="text-[11px] text-gray-500">
                  Cần upload đủ 3 khối trước khi tổng kết tuần.
                </div>
              ) : null}
            </div>

            {missingLogs.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-800">
                  Danh sách tiết chưa nhập sổ đầu bài / nhập sai (đã tạm tính 10 điểm)
                </div>
                <textarea
                  readOnly
                  className="mt-2 h-40 w-full rounded-xl border border-amber-200 bg-white p-3 text-xs text-gray-700"
                  value={missingLogs.map(formatMissingLog).join("\n")}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={copyMissingLogs}
                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-amber-200"
                  >
                    Sao chép
                  </button>
                  <button
                    onClick={downloadMissingLogs}
                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-amber-200"
                  >
                    Tải Excel
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => weekId && load(weekId, date, grade)}
              className="rounded-2xl bg-[#2e77df] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Tải lại
            </button>

            <button
              onClick={closeWeek}
              disabled={!!closedAt || !weekId || !canCloseWeek}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              Tổng kết tuần
            </button>

            <button
              onClick={reopenWeek}
              disabled={!closedAt || !weekId}
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50 disabled:opacity-50"
            >
              Mở khóa tuần
            </button>

            <Link
              to="/admin/weekly-summary"
              className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
            >
              Xem bảng xếp hạng
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
            <div className="text-sm text-gray-600">Đang tải dữ liệu...</div>
          </div>
        ) : (
          <div className="edp-glass-panel rounded-[32px] p-0 overflow-hidden">
            <div className="px-5 py-4 flex flex-wrap items-center gap-3">
              <div className="text-sm font-semibold text-gray-900">
                {visibleSessions.length} phiếu
              </div>
              {grade ? (
                <div className="text-xs text-gray-500">Khối: {grade}</div>
              ) : null}
              <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                <input
                  type="checkbox"
                  checked={showSigned}
                  onChange={() => setShowSigned(!showSigned)}
                />
                Đã ký
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                <input
                  type="checkbox"
                  checked={showDraft}
                  onChange={() => setShowDraft(!showDraft)}
                />
                Chưa ký
              </label>
            </div>

            <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
              <div className="text-xs text-gray-500">{selectedIds.length} đã chọn</div>
              <button
                onClick={selectAllVisible}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
              >
                Chọn tất cả
              </button>
              <button
                onClick={clearSelected}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-blue-50"
              >
                Bỏ chọn
              </button>
              <input
                type="password"
                value={adminSignPassword}
                onChange={(e) => setAdminSignPassword(e.target.value)}
                placeholder="Mật khẩu quản trị"
                className="h-8 rounded-full border border-blue-100 px-3 text-xs outline-none focus:border-[#2e77df]"
              />
              <button
                disabled={adminSigning}
                onClick={adminSignSelected}
                className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {adminSigning ? "Đang ký..." : "Ký đã chọn"}
              </button>
              <button
                onClick={deleteSelected}
                className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
              >
                Xóa đã chọn
              </button>
            </div>

            {visibleSessions.length === 0 ? (
              <div className="px-5 pb-6 text-sm text-gray-600">
                Không có phiếu trực theo bộ lọc hiện tại.
              </div>
            ) : (
              <>
                {/* mobile cards */}
                <div className="lg:hidden divide-y divide-blue-50">
                  {visibleSessions.map((s) => (
                    <button
                      key={s.id}
                      className="w-full text-left px-5 py-4 hover:bg-slate-50 transition"
                      onClick={() => openDetail(s.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="pt-1"
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSet.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-semibold text-gray-900">
                            {weekday(s.date)} {formatDateISO(s.date)}: {s.red_class} trực {s.duty_class}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            Tổng điểm:{" "}
                            <span
                              className={`font-semibold ${
                                Number(s.total_score) >= 0 ? "text-emerald-700" : "text-red-600"
                              }`}
                            >
                              {Number(s.total_score) > 0
                                ? `+${s.total_score}`
                                : String(s.total_score)}
                            </span>{" "}
                            | Vi phạm:{" "}
                            <span className="font-semibold text-gray-700">
                              {Number(s.violation_score) > 0
                                ? `+${s.violation_score}`
                                : String(s.violation_score)}
                            </span>{" "}
                            | Cộng:{" "}
                            <span className="font-semibold text-[#2e77df]">
                              +{s.bonus_points || 0}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          {s.status === "signed" ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                              Đã ký
                            </span>
                          ) : (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                              Nháp
                            </span>
                          )}
                          {s.signature_photo_path ? (
                            <span className="text-[11px] text-gray-500">Có ảnh</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* desktop table */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-gray-600">
                      <tr>
                        <th className="text-left font-semibold px-5 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={() => {
                              if (allVisibleSelected) {
                                clearSelected()
                              } else {
                                selectAllVisible()
                              }
                            }}
                          />
                        </th>
                        <th
                          onClick={() => clickSort("date")}
                          className="text-left font-semibold px-5 py-3 w-40 cursor-pointer select-none"
                        >
                          Ngày
                        </th>
                        <th
                          onClick={() => clickSort("red_class")}
                          className="text-left font-semibold px-5 py-3 cursor-pointer select-none"
                        >
                          Cờ đỏ
                        </th>
                        <th
                          onClick={() => clickSort("duty_class")}
                          className="text-left font-semibold px-5 py-3 cursor-pointer select-none"
                        >
                          Lớp trực
                        </th>
                        <th
                          onClick={() => clickSort("total_score")}
                          className="text-right font-semibold px-5 py-3 w-32 cursor-pointer select-none"
                        >
                          Điểm
                        </th>
                        <th className="text-left font-semibold px-5 py-3 w-36">Trạng thái</th>
                        <th className="text-left font-semibold px-5 py-3 w-24">Ảnh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-50">
                      {visibleSessions.map((s) => (
                        <tr
                          key={s.id}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => openDetail(s.id)}
                        >
                          <td
                            className="px-5 py-3"
                            onClick={(e) => {
                              e.stopPropagation()
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSet.has(s.id)}
                              onChange={() => toggleSelect(s.id)}
                            />
                          </td>
                          <td className="px-5 py-3">
                            {weekday(s.date)} {formatDateISO(s.date)}
                          </td>
                          <td className="px-5 py-3 font-semibold text-gray-900">
                            {s.red_class}
                          </td>
                          <td className="px-5 py-3 font-semibold text-gray-900">
                            {s.duty_class}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-red-600">
                            {s.total_score}
                          </td>
                          <td className="px-5 py-3">
                            {s.status === "signed" ? (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                Đã ký
                              </span>
                            ) : (
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                                Nháp
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-gray-600">
                            {s.signature_photo_path ? "Có" : "Không"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
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
                        Ngày: {detail.session.date} | Trạng thái: {formatDutyStatus(detail.session.status)}
                      </div>
                      <button
                        onClick={() => deleteSession(detail.session.id)}
                        className="ml-auto rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                      >
                        Xóa phiếu
                      </button>
                    </div>

                    {detail.session.status !== "signed" ? (
                      <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-blue-100">
                        <div className="text-xs font-semibold text-gray-700">
                          Ký phụ (Quản trị)
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            type="password"
                            value={adminSignPassword}
                            onChange={(e) => setAdminSignPassword(e.target.value)}
                            placeholder="Mật khẩu quản trị"
                            className="flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                          />
                          <button
                            disabled={adminSigning}
                            onClick={() => adminSignSession(detail.session.id)}
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                          >
                            {adminSigning ? "Đang ký..." : "Ký"}
                          </button>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          Không cần PIN. Hệ thống sẽ ghi lại lịch sử: Ký (quản trị).
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {(() => {
                    const vio = (detail.violations || []).reduce(
                      (sum: number, v: any) =>
                        sum + Number(v.score_delta || 0) * Number(v.quantity || 0),
                      0,
                    )
                    const bonus = Number(detail.session?.bonus_points || 0)
                    const total = vio + bonus
                    const minScore = detail.session?.bonus_min_score
                    return (
                      <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                        <div className="text-xs text-gray-500">Tổng điểm</div>
                        <div
                          className={`mt-1 text-3xl font-semibold ${
                            total >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {total > 0 ? `+${total}` : String(total)}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <div className="text-[11px] text-gray-500">Vi phạm</div>
                            <div className="mt-0.5 text-sm font-semibold text-gray-900">
                              {vio > 0 ? `+${vio}` : String(vio)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <div className="text-[11px] text-gray-500">Cộng sổ đầu bài</div>
                            <div className="mt-0.5 text-sm font-semibold text-[#2e77df]">
                              +{bonus}
                            </div>
                            {minScore != null ? (
                              <div className="mt-0.5 text-[11px] text-gray-500">
                                Min tiết: {minScore}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-50">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-gray-900">
                        Sổ đầu bài (Quản trị)
                      </div>
                      <div className="ml-auto text-xs text-gray-500">
                        Tổng:{" "}
                        <b>
                          {bonusPeriods.reduce((s, x) => s + Number(x.score || 0), 0)}
                        </b>
                      </div>
                    </div>

                    <div className="mt-2 space-y-2">
                      {bonusPeriods.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={p.subject}
                            onChange={(e) => {
                              const v = e.target.value
                              setBonusPeriods((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, subject: v } : x)),
                              )
                            }}
                            placeholder="Tên tiết"
                            className="flex-1 rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                          />
                          <input
                            type="number"
                            value={Number.isFinite(p.score) ? p.score : ""}
                            onChange={(e) => {
                              const v = e.target.value === "" ? NaN : Number(e.target.value)
                              setBonusPeriods((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, score: v } : x)),
                              )
                            }}
                            className="w-24 rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                          />
                          <button
                            onClick={() =>
                              setBonusPeriods((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="rounded-xl bg-white px-2 py-1 text-xs font-semibold text-gray-700 ring-1 ring-blue-50"
                          >
                            Xóa
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          setBonusPeriods((prev) => [...prev, { subject: "", score: 10 }])
                        }
                        className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-blue-50"
                      >
                        Thêm tiết
                      </button>
                      <button
                        disabled={bonusSaving}
                        onClick={saveBonusPeriods}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                      >
                        {bonusSaving ? "Đang lưu..." : "Lưu điểm"}
                      </button>
                    </div>

                    <div className="mt-1 text-[11px] text-gray-500">
                      Không cộng tiết Giáo dục thể chất.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-900">Vi phạm</div>
                    <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_120px] gap-2">
                        <select
                          value={newViolationRule}
                          onChange={(e) =>
                            setNewViolationRule(e.target.value ? Number(e.target.value) : "")
                          }
                          className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                        >
                          <option value="">Chọn lỗi</option>
                          {rules.map((r: any) => (
                            <option key={r.id} value={r.id}>
                              {r.category} - {r.name} ({r.score_delta})
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={newViolationQty}
                          onChange={(e) => setNewViolationQty(Number(e.target.value || 1))}
                          className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                          placeholder="Số lượng"
                        />
                        <input
                          type="text"
                          value={newViolationNote}
                          onChange={(e) => setNewViolationNote(e.target.value)}
                          className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                          placeholder="Ghi chú (nếu có)"
                        />
                        <button
                          onClick={addViolation}
                          disabled={violationSaving}
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                        >
                          Thêm lỗi
                        </button>
                      </div>
                    </div>
                    {detail.violations.length === 0 ? (
                      <div className="text-sm text-gray-600">Không có vi phạm.</div>
                    ) : (
                      detail.violations.map((v: any) => {
                        const isEditing = editingViolationId === v.id
                        return (
                          <div
                            key={v.id}
                            className="rounded-2xl border border-blue-100 bg-white px-4 py-3"
                          >
                            {isEditing ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr] gap-2">
                                  <select
                                    value={editViolationRule}
                                    onChange={(e) =>
                                      setEditViolationRule(
                                        e.target.value ? Number(e.target.value) : "",
                                      )
                                    }
                                    className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                                  >
                                    <option value="">Chọn lỗi</option>
                                    {rules.map((r: any) => (
                                      <option key={r.id} value={r.id}>
                                        {r.category} - {r.name} ({r.score_delta})
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    value={editViolationQty}
                                    onChange={(e) =>
                                      setEditViolationQty(Number(e.target.value || 1))
                                    }
                                    className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                                  />
                                  <input
                                    type="text"
                                    value={editViolationNote}
                                    onChange={(e) => setEditViolationNote(e.target.value)}
                                    className="rounded-xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#2e77df]"
                                    placeholder="Ghi chú"
                                  />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => saveEditViolation(v.id)}
                                    disabled={violationSaving}
                                    className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    onClick={() => setEditingViolationId(null)}
                                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-blue-50"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
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
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => startEditViolation(v)}
                                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-blue-50"
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    onClick={() => removeViolation(v.id)}
                                    disabled={violationSaving}
                                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-red-600 shadow-sm ring-1 ring-red-100"
                                  >
                                    Xóa
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  <div className="overflow-hidden rounded-2xl ring-1 ring-blue-100 bg-slate-50">
                    {detail.session.signature_photo_path ? (
                      <img src={detail.session.signature_photo_path} className="w-full" />
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-500">
                        Chưa có ảnh ký
                      </div>
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
                    <div className="text-sm font-semibold text-gray-900">Lịch sử ký</div>
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
