const path = require("path")
const { readFile } = require("fs/promises")

const PROMPT_TEMPLATE_PATH = path.join(__dirname, "prompts", "weekly_summary.md")

async function buildWeeklySummaryPrompt(context) {
  const template = await readFile(PROMPT_TEMPLATE_PATH, "utf8")
  return template.replace("{{CONTEXT}}", JSON.stringify(context, null, 2))
}

module.exports = {
  buildWeeklySummaryPrompt,
}
