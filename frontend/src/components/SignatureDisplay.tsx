type Props = {
  svg?: string | null
  className?: string
}

export default function SignatureDisplay({ svg, className = "" }: Props) {
  if (!svg) return null
  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt="Chữ ký xác nhận"
      className={`block w-full bg-white object-contain ${className}`}
    />
  )
}
