type Props = {
  onClose: () => void
}

export default function SelectorBackdrop({ onClose }: Props) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Đóng danh sách chọn"
      onClick={onClose}
      className="fixed inset-0 z-40 cursor-default bg-transparent"
    />
  )
}
