import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"

import { api } from "../../api/api"
import ModalShell from "../../components/ModalShell"
import Footer from "../../components/Footer"
import Navbar from "../../components/Navbar"
import { usePageTitle } from "../../utils/usePageTitle"

type Rule = {
  id: number
  category: string
  name: string
  score_delta: number
}

type RuleFormState = {
  category: string
  name: string
  score_delta: string
}

const EMPTY_FORM: RuleFormState = {
  category: "",
  name: "",
  score_delta: "",
}

function toBase64(buffer: ArrayBuffer) {
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return window.btoa(binary)
}

export default function AdminRules() {
  usePageTitle("EDP | Quản lý luật")

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [rules, setRules] = useState<Rule[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)

  useEffect(() => {
    void loadRules()
  }, [])

  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return rules

    return rules.filter((rule) => {
      return (
        rule.name.toLowerCase().includes(keyword) ||
        rule.category.toLowerCase().includes(keyword) ||
        String(rule.score_delta).includes(keyword)
      )
    })
  }, [rules, search])

  async function loadRules() {
    try {
      setLoading(true)
      const res = await api.get<Rule[]>("/rules/admin")
      setRules(res.data || [])
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được danh sách luật")
    } finally {
      setLoading(false)
    }
  }

  function openCreateModal() {
    setEditingRule(null)
    setForm(EMPTY_FORM)
    setShowEditor(true)
  }

  function openEditModal(rule: Rule) {
    setEditingRule(rule)
    setForm({
      category: rule.category,
      name: rule.name,
      score_delta: String(rule.score_delta),
    })
    setShowEditor(true)
  }

  function closeEditor() {
    if (saving) return
    setShowEditor(false)
    setEditingRule(null)
    setForm(EMPTY_FORM)
  }

  async function submitRule() {
    const category = form.category.trim()
    const name = form.name.trim()
    const score = Number(form.score_delta)

    if (!category || !name) {
      toast.error("Vui lòng nhập đầy đủ nhóm luật và tên lỗi")
      return
    }

    if (!Number.isFinite(score)) {
      toast.error("Điểm phải là số hợp lệ")
      return
    }

    try {
      setSaving(true)

      if (editingRule) {
        await api.patch(`/rules/${editingRule.id}`, {
          category,
          name,
          score_delta: score,
        })
        toast.success("Đã cập nhật luật")
      } else {
        await api.post("/rules/create", {
          category,
          name,
          score_delta: score,
        })
        toast.success("Đã tạo luật mới")
      }

      closeEditor()
      await loadRules()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không lưu được luật")
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(rule: Rule) {
    const shouldDelete = window.confirm(`Xóa luật "${rule.name}"?`)
    if (!shouldDelete) return

    try {
      await api.delete(`/rules/${rule.id}`)
      toast.success("Đã xóa luật")
      await loadRules()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không xóa được luật")
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    try {
      setImporting(true)
      const buffer = await file.arrayBuffer()
      await api.post("/rules/import", {
        fileName: file.name,
        fileData: toBase64(buffer),
      })
      toast.success("Đã import danh sách luật")
      await loadRules()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không import được file Excel")
    } finally {
      setImporting(false)
    }
  }

  async function exportRules() {
    try {
      setExporting(true)
      const res = await api.get("/rules/export", {
        responseType: "blob",
      })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement("a")
      link.href = url
      link.download = "rules.xlsx"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      toast.success("Đã export file Excel")
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không export được file Excel")
    } finally {
      setExporting(false)
    }
  }

  async function downloadTemplate() {
    try {
      const res = await api.get("/rules/template", {
        responseType: "blob",
      })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement("a")
      link.href = url
      link.download = "template_rules.xlsx"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.response?.data?.error || "Không tải được file mẫu")
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#edf5ff_0%,#f8fbff_34%,#f3f6fb_100%)]">
      <Navbar />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Link to="/admin/dashboard" className="transition hover:text-[#2e77df]">
            Bảng điều khiển
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Quản lý luật</span>
        </div>

        <section className="edp-glass-panel rounded-[32px] px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2e77df]/70">
                Quản lý luật
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Quản lý luật thi đua
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Quản lý danh mục lỗi vi phạm, import và export Excel theo đúng định dạng chuẩn của hệ thống.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="min-h-11 rounded-[18px] border border-white/70 bg-white/72 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
              >
                {importing ? "Đang import..." : "Import Excel"}
              </button>
              <button
                type="button"
                onClick={() => void exportRules()}
                disabled={exporting}
                className="min-h-11 rounded-[18px] border border-white/70 bg-white/72 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
              >
                {exporting ? "Đang export..." : "Export Excel"}
              </button>
              <button
                type="button"
                onClick={() => void downloadTemplate()}
                className="min-h-11 rounded-[18px] border border-white/70 bg-white/72 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.06)] transition duration-200 active:scale-[0.98]"
              >
                Tải file mẫu
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98]"
              >
                + Tạo luật mới
              </button>
            </div>
          </div>
        </section>

        <section className="edp-glass-panel rounded-[32px] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Danh sách luật</h2>
              <p className="mt-1 text-sm text-slate-500">Tìm kiếm theo nhóm, tên lỗi hoặc điểm trừ.</p>
            </div>

            <label className="block w-full lg:max-w-xs">
              <span className="sr-only">Tìm luật</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm luật..."
                className="w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] placeholder:text-slate-400 focus:border-[#2e77df]"
              />
            </label>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />

          <div className="mt-5 overflow-x-auto rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/90 text-slate-500">
                <tr>
                  <th className="px-4 py-4 text-left font-semibold">#</th>
                  <th className="px-4 py-4 text-left font-semibold">Nhóm</th>
                  <th className="px-4 py-4 text-left font-semibold">Tên lỗi</th>
                  <th className="px-4 py-4 text-left font-semibold">Điểm</th>
                  <th className="px-4 py-4 text-right font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index} className="border-t border-slate-100/80">
                      <td className="px-4 py-4" colSpan={5}>
                        <div className="h-12 animate-pulse rounded-[18px] bg-slate-100/80" />
                      </td>
                    </tr>
                  ))
                ) : filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center text-sm text-slate-500">
                      Không có luật phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredRules.map((rule, index) => (
                    <tr key={rule.id} className="border-t border-slate-100/80 transition hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-slate-500">{index + 1}</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#2e77df]">
                          {rule.category}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-900">{rule.name}</td>
                      <td className="px-4 py-4 font-semibold text-rose-600">{rule.score_delta}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(rule)}
                            className="min-h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition duration-200 active:scale-[0.98]"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRule(rule)}
                            className="min-h-10 rounded-[16px] border border-rose-100 bg-white px-3 text-xs font-semibold text-rose-600 transition duration-200 active:scale-[0.98]"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Footer />

      {showEditor && (
        <ModalShell className="max-w-lg p-6" onClose={closeEditor}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                {editingRule ? "Chỉnh sửa luật" : "Tạo luật mới"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Nhập đúng nhóm lỗi, tên lỗi và điểm trừ theo quy chế hiện hành.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Nhóm</span>
              <input
                value={form.category}
                onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
                placeholder="Ví dụ: Đồng phục"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Tên lỗi</span>
              <input
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
                placeholder="Ví dụ: Không bảng tên"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">Điểm trừ</span>
              <input
                type="number"
                value={form.score_delta}
                onChange={(e) => setForm((current) => ({ ...current, score_delta: e.target.value }))}
                className="w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2e77df]"
                placeholder="-2"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeEditor}
              disabled={saving}
              className="min-h-11 rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void submitRule()}
              disabled={saving}
              className="min-h-11 rounded-[18px] bg-[#2e77df] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(46,119,223,0.22)] transition duration-200 active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? "Đang lưu..." : editingRule ? "Lưu thay đổi" : "Tạo luật"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
