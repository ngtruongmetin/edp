import { useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"

import { api } from "../api/api"
import EvidenceFilePreviewModal, { type EvidencePreviewFile } from "./EvidenceFilePreviewModal"

type DutyEvidenceImage = EvidencePreviewFile & {
  id: number
  byte_size: number
  sort_order: number
  created_at: string
}

type Props = {
  sessionId: number
  readOnly?: boolean
}

const MAX_IMAGES = 10
const MAX_FILE_BYTES = 1536 * 1024
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export default function DutyEvidencePanel({ sessionId, readOnly = false }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [images, setImages] = useState<DutyEvidenceImage[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  async function loadImages() {
    try {
      setLoading(true)
      const response = await api.get<{ images: DutyEvidenceImage[] }>(`/duty/session/${sessionId}/evidences`)
      setImages(Array.isArray(response.data?.images) ? response.data.images : [])
    } catch (error) {
      console.error(error)
      toast.error("Không thể tải ảnh minh chứng")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadImages()
  }, [sessionId])

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ""
    if (!selectedFiles.length) return

    const remainingSlots = MAX_IMAGES - images.length
    if (selectedFiles.length > remainingSlots) {
      toast.error(`Phiếu trực chỉ còn ${remainingSlots} vị trí ảnh`)
      return
    }

    const invalidFile = selectedFiles.find(
      (file) => !ACCEPTED_TYPES.has(file.type) || file.size > MAX_FILE_BYTES,
    )
    if (invalidFile) {
      toast.error("Chỉ hỗ trợ ảnh JPG, PNG, WebP tối đa 1.5 MB")
      return
    }

    try {
      setUploading(true)
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append("files", file))
      await api.post(`/duty/session/${sessionId}/evidences`, formData)
      await loadImages()
      toast.success("Đã thêm ảnh minh chứng")
    } catch (error) {
      console.error(error)
      toast.error("Không thể thêm ảnh minh chứng")
    } finally {
      setUploading(false)
    }
  }

  async function removeImage(image: DutyEvidenceImage) {
    if (!confirm(`Xóa ảnh "${image.file_name}"?`)) return

    try {
      setRemovingId(image.id)
      await api.delete(`/duty/evidence/${image.id}`)
      setImages((current) => current.filter((item) => item.id !== image.id))
      setPreviewIndex((current) => (current == null ? null : Math.min(current, Math.max(images.length - 2, 0))))
      toast.success("Đã xóa ảnh minh chứng")
    } catch (error) {
      console.error(error)
      toast.error("Không thể xóa ảnh minh chứng")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-blue-50">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">Minh chứng vi phạm</h2>
          <p className="mt-1 text-xs text-gray-500">{images.length}/{MAX_IMAGES} ảnh</p>
        </div>
        {!readOnly && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => void handleFileSelection(event)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || loading || images.length >= MAX_IMAGES}
              className="min-h-10 rounded-xl bg-[#2e77df] px-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
            >
              {uploading ? "Đang thêm" : "Thêm ảnh"}
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((index) => <div key={index} className="aspect-square animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : images.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Chưa có minh chứng vi phạm.</p>
      ) : (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {images.map((image, index) => (
            <div key={image.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100">
              <button
                type="button"
                onClick={() => setPreviewIndex(index)}
                className="h-full w-full"
                aria-label={`Xem ảnh ${index + 1}`}
              >
                <img src={image.url} alt={image.file_name} className="h-full w-full object-cover" />
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void removeImage(image)}
                  disabled={removingId === image.id}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/70 text-base leading-none text-white transition hover:bg-red-600 disabled:opacity-50"
                  aria-label={`Xóa ${image.file_name}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {previewIndex != null && (
        <EvidenceFilePreviewModal
          files={images}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  )
}
