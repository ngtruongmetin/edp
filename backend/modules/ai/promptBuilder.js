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

function buildSchemaContent() {
  return ["```json", JSON.stringify(codoParseSchema, null, 2), "```"].join("\n")
}

function buildDutyContextLine(context) {
  const dutyId = formatValue(context?.duty?.id, "0")
  const date = formatValue(context?.duty?.date)
  const status = formatValue(context?.duty?.status)
  return `Sheet:${dutyId}|${date}|${status}`
}

function buildClassContextLine(context) {
  return `Class:${formatValue(context?.targetClass?.name)}`
}

function buildRulesSection(rules) {
  const normalizedRules = Array.isArray(rules) ? rules : []

  if (normalizedRules.length === 0) {
    return ""
  }

  return normalizedRules
    .map((rule) => `${formatValue(rule?.id)}|${formatValue(rule?.name)}`)
    .join("\n")
}

function buildContextContent(context) {
  return [
    buildDutyContextLine(context),
    buildClassContextLine(context),
    buildRulesSection(context?.rules),
  ]
    .filter(Boolean)
    .join("\n")
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
