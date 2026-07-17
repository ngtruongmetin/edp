const path = require("path")
const { readFile } = require("fs/promises")

const { codoParseSchema } = require("./schema")

const PROMPT_TEMPLATE_PATH = path.join(__dirname, "prompts", "codo_system.md")

function formatValue(value, emptyLabel = "(không có)") {
  if (value === null || value === undefined || value === "") {
    return emptyLabel
  }

  return String(value)
}

function formatBoolean(value) {
  return value ? "Có" : "Không"
}

function formatAliases(aliases) {
  if (!Array.isArray(aliases) || aliases.length === 0) {
    return "(chưa có)"
  }

  return aliases.join(", ")
}

function buildSchemaContent() {
  return ["```json", JSON.stringify(codoParseSchema, null, 2), "```"].join("\n")
}

function buildDutyContextSection(context) {
  return [
    "## Thông tin phiếu trực",
    `- Mã phiếu: ${formatValue(context?.duty?.id)}`,
    `- Ngày: ${formatValue(context?.duty?.date)}`,
    `- Trạng thái: ${formatValue(context?.duty?.status)}`,
    "",
    "## Lớp đang được kiểm tra",
    `- ${formatValue(context?.targetClass?.name)}`,
  ].join("\n")
}

function buildRulesSection(rules) {
  const normalizedRules = Array.isArray(rules) ? rules : []

  if (normalizedRules.length === 0) {
    return ["## Danh sách luật", "- (không có dữ liệu)"].join("\n")
  }

  return [
    "## Danh sách luật",
    ...normalizedRules.map((rule, index) =>
      [
        `${index + 1}.`,
        `Mã luật: ${formatValue(rule?.id)}`,
        `Tên: ${formatValue(rule?.name)}`,
        `Điểm: -${Math.abs(Number(rule?.minus_points || 0))}`,
        `Cho phép nhập số lượng: ${formatBoolean(rule?.allow_quantity)}`,
        `Alias: ${formatAliases(rule?.aliases)}`,
      ].join("\n"),
    ),
  ].join("\n\n")
}

function buildContextContent(context) {
  return [buildDutyContextSection(context), "", buildRulesSection(context?.rules)].join(
    "\n",
  )
}

function buildMessageContent(message) {
  return formatValue(message)
}

async function loadPromptTemplate() {
  return readFile(PROMPT_TEMPLATE_PATH, "utf8")
}

function replacePlaceholders(template, replacements) {
  return Object.entries(replacements).reduce((output, [placeholder, value]) => {
    return output.replaceAll(`{{${placeholder}}}`, value)
  }, template)
}

async function buildCodoParsePrompt({ context, message }) {
  const template = await loadPromptTemplate()

  return replacePlaceholders(template, {
    SCHEMA: buildSchemaContent(),
    CONTEXT: buildContextContent(context),
    MESSAGE: buildMessageContent(message),
  })
}

module.exports = {
  buildCodoParsePrompt,
}
