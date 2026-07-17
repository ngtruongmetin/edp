const fs = require("fs/promises")
const path = require("path")

const initDb = require("../utils/init")
const db = require("../db")
const { buildCodoPromptPreview } = require("../modules/ai/service")

function parseArgs(argv) {
  const args = [...argv]
  const messageParts = []
  let outputPath = ""

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg === "--out" && args[i + 1]) {
      outputPath = args[i + 1]
      i += 1
      continue
    }

    if (arg.startsWith("--out=")) {
      outputPath = arg.slice("--out=".length)
      continue
    }

    messageParts.push(arg)
  }

  return {
    message: messageParts.join(" ").trim(),
    outputPath: outputPath.trim(),
  }
}

async function main() {
  const { message, outputPath } = parseArgs(process.argv.slice(2))

  if (!message) {
    console.error('Usage: node scripts/codo_prompt_preview.js "message" [--out file.txt]')
    process.exit(1)
  }

  await initDb()

  try {
    const { prompt } = await buildCodoPromptPreview({ message })
    const filePath = outputPath
      ? path.resolve(process.cwd(), outputPath)
      : path.resolve(process.cwd(), `codo_prompt_preview_${Date.now()}.txt`)

    await fs.writeFile(filePath, prompt, "utf8")

    console.log(filePath)
    console.log(prompt)
  } finally {
    await db.close().catch(() => {})
  }
}

main().catch(async (err) => {
  console.error(err)
  await db.close().catch(() => {})
  process.exit(1)
})
