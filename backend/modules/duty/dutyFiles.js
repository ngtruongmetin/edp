const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const DUTY_EVIDENCE_LIMIT = 10
const DUTY_EVIDENCE_MAX_BYTES = 1536 * 1024
const DUTY_EVIDENCE_DIRECTORY = path.join(__dirname, "..", "..", "assets", "duty-evidences")
const DUTY_SIGNATURE_DIRECTORY = path.join(__dirname, "..", "..", "assets", "duty-signatures")
const DUTY_EVIDENCE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
])

function sanitizeDutyEvidenceFileName(value) {
  return String(value || "minh-chung")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 160)
}

async function writeDutyImage(directory, prefix, file) {
  const extension = DUTY_EVIDENCE_TYPES.get(String(file?.mimetype || "").toLowerCase())
  if (!extension) {
    const error = new Error("Ảnh chỉ hỗ trợ JPG, PNG hoặc WebP.")
    error.status = 400
    throw error
  }

  await fs.promises.mkdir(directory, { recursive: true })
  const fileName = `${prefix}-${Date.now()}-${crypto.randomUUID()}.${extension}`
  const diskPath = path.join(directory, fileName)
  await fs.promises.writeFile(diskPath, file.buffer, { flag: "wx" })
  return { fileName, diskPath }
}

module.exports = {
  DUTY_EVIDENCE_DIRECTORY,
  DUTY_EVIDENCE_LIMIT,
  DUTY_EVIDENCE_MAX_BYTES,
  DUTY_EVIDENCE_TYPES,
  DUTY_SIGNATURE_DIRECTORY,
  sanitizeDutyEvidenceFileName,
  writeDutyImage,
}
