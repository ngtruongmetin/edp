const fs = require("fs")
const path = require("path")

let loaded = false

function loadEnv() {
  if (loaded) {
    return
  }

  const filePath = path.join(__dirname, "..", "..", ".env")
  if (!fs.existsSync(filePath)) {
    loaded = true
    return
  }

  const content = fs.readFileSync(filePath, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  loaded = true
}

module.exports = {
  loadEnv,
}
