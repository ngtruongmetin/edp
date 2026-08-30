const express = require("express")
const xlsx = require("xlsx")
const ExcelJS = require("exceljs")

const db = require("../../db")
const { isForeignKeyError, mapDatabaseError } = require("../../utils/dbp")
const requireLogin = require("../../middleware/requireLogin")
const requireRole = require("../../middleware/requireRole")

const router = express.Router()

const REQUIRED_HEADERS = ["Category", "Rule", "Point"]
const RULE_CODE_HEADER = "Code"

function normalizeText(value) {
  return String(value || "").trim()
}

function isBlankRow(row) {
  return REQUIRED_HEADERS.every((key) => normalizeText(row?.[key]) === "")
}

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  const normalized = normalizeText(value).replace(",", ".")
  if (!normalized) return null
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return null
  return Math.trunc(numeric)
}

function normalizeRuleCode(value) {
  const code = normalizeText(value).toUpperCase()
  if (!code) return null
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
    const err = new Error("Rule code must contain only uppercase letters, digits, and underscores")
    err.status = 400
    throw err
  }
  return code
}

function generateRuleCode(category, name) {
  const source = `${category}|${name}`
  const hex = Buffer.from(source, "utf8").toString("hex").toUpperCase().slice(0, 54)
  return `IMPORTED_${hex}`
}

function buildRulesWorksheet(workbook) {
  const sheet = workbook.addWorksheet("Rules")
  sheet.columns = [
    { header: RULE_CODE_HEADER, key: "rule_code", width: 28 },
    { header: "Category", key: "category", width: 24 },
    { header: "Rule", key: "name", width: 42 },
    { header: "Point", key: "score_delta", width: 14 },
  ]
  return sheet
}

function styleRulesSheet(sheet) {
  sheet.eachRow((row) => {
    row.height = 22
    row.eachCell((cell) => {
      cell.font = { name: "Times New Roman", size: 12 }
      cell.alignment = { horizontal: "center", vertical: "middle" }
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      }
    })
  })
}

function parseImportWorkbook(fileData) {
  if (!fileData) {
    const err = new Error("Thiếu dữ liệu file")
    err.status = 400
    throw err
  }

  let workbook
  try {
    const buffer = Buffer.from(fileData, "base64")
    workbook = xlsx.read(buffer, { type: "buffer" })
  } catch {
    const err = new Error("Không đọc được file Excel")
    err.status = 400
    throw err
  }

  const firstSheetName = workbook.SheetNames[0]
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null
  if (!sheet) {
    const err = new Error("File Excel không có sheet dữ liệu")
    err.status = 400
    throw err
  }

  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  })

  const headerRow = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    range: 0,
    blankrows: false,
  })[0] || []

  const normalizedHeaders = headerRow.map((value) => normalizeText(value))
  const offset = normalizedHeaders[0] === RULE_CODE_HEADER ? 1 : 0
  const hasRequiredHeaders = REQUIRED_HEADERS.every((header, index) => normalizedHeaders[index + offset] === header)
  if (!hasRequiredHeaders) {
    const err = new Error("File Excel phải có đúng 3 cột: Category | Rule | Point")
    err.status = 400
    throw err
  }

  const parsedRows = []

  rows.forEach((row, index) => {
    if (isBlankRow(row)) return

    const category = normalizeText(row.Category)
    const name = normalizeText(row.Rule)
    const score = toInteger(row.Point)
    const suppliedRuleCode = normalizeRuleCode(row[RULE_CODE_HEADER])
    const ruleCode = suppliedRuleCode || generateRuleCode(category, name)

    if (!category || !name) {
      const err = new Error(`Dòng ${index + 2} thiếu Category hoặc Rule`)
      err.status = 400
      throw err
    }

    if (score == null) {
      const err = new Error(`Dòng ${index + 2} có Point không hợp lệ`)
      err.status = 400
      throw err
    }

    parsedRows.push({
      category,
      name,
      score_delta: score,
      rule_code: ruleCode,
      has_rule_code: Boolean(suppliedRuleCode),
    })
  })

  if (!parsedRows.length) {
    const err = new Error("File Excel không có dữ liệu hợp lệ để import")
    err.status = 400
    throw err
  }

  return parsedRows
}

router.get(
  "/",
  requireLogin,
  (req, res) => {
    db.all(
      `
        SELECT id, rule_code, category, name, score_delta
        FROM rules
        ORDER BY category, id
      `,
      [],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message })
        }

        res.json(rows)
      },
    )
  },
)

router.get(
  "/admin",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.all(
      `
        SELECT id, rule_code, category, name, score_delta
        FROM rules
        ORDER BY category, id
      `,
      [],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message })
        }

        res.json(rows)
      },
    )
  },
)

router.get(
  "/template",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const workbook = new ExcelJS.Workbook()
      const sheet = buildRulesWorksheet(workbook)

      sheet.addRow({
        rule_code: "AUTHORIZED_ABSENCE",
        category: "Nề nếp",
        name: "Đi học muộn",
        score_delta: -5,
      })
      sheet.addRow({
        rule_code: "POSITIVE_ACTIVITY",
        category: "Phong trào",
        name: "Tham gia hoạt động tốt",
        score_delta: 10,
      })
      styleRulesSheet(sheet)

      const buffer = await workbook.xlsx.writeBuffer()
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      res.setHeader("Content-Disposition", 'attachment; filename="template_rules.xlsx"')
      res.send(Buffer.from(buffer))
    } catch (err) {
      res.status(500).json({ error: err.message || "Cannot create template" })
    }
  },
)

router.get(
  "/export",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const rules = await db.all(
        `
          SELECT rule_code, category, name, score_delta
          FROM rules
          ORDER BY category, id
        `,
      )

      const workbook = new ExcelJS.Workbook()
      const sheet = buildRulesWorksheet(workbook)

      for (const rule of rules) {
        sheet.addRow({
          rule_code: rule.rule_code || "",
          category: rule.category,
          name: rule.name,
          score_delta: rule.score_delta,
        })
      }

      styleRulesSheet(sheet)

      const buffer = await workbook.xlsx.writeBuffer()
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      res.setHeader("Content-Disposition", 'attachment; filename="rules.xlsx"')
      res.send(Buffer.from(buffer))
    } catch (err) {
      res.status(500).json({ error: err.message || "Không thể export file Excel" })
    }
  },
)

router.post(
  "/import",
  requireLogin,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const importedRows = parseImportWorkbook(req.body?.fileData)

      await db.withTransaction(async () => {
        for (const row of importedRows) {
          // Keep the nullable rule_code branch separate. PostgreSQL cannot infer
          // the type of a parameter used only in "? IS NULL" when its value is
          // null, which caused imports to fail with an indeterminate $2 type.
          const existing = row.has_rule_code
            ? await db.get(
                `
                  SELECT id
                  FROM rules
                  WHERE rule_code=?
                  LIMIT 1
                `,
                [row.rule_code],
              )
            : await db.get(
                `
                  SELECT id
                  FROM rules
                  WHERE rule_code IS NULL AND category=? AND name=?
                  LIMIT 1
                `,
                [row.category, row.name],
              )

          if (existing?.id) {
            await db.run(
              `
                UPDATE rules
                SET category=?, name=?, score_delta=?, rule_code=COALESCE(?, rule_code)
                WHERE id=?
              `,
              [row.category, row.name, row.score_delta, row.rule_code, existing.id],
            )
            continue
          }

          await db.run(
            `
              INSERT INTO rules(rule_code, category, name, score_delta)
              VALUES(?,?,?,?)
            `,
            [row.rule_code, row.category, row.name, row.score_delta],
          )
        }
      })

      res.json({
        success: true,
        imported: importedRows.length,
        message: "Đã import danh sách luật",
      })
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message || "Không thể import file Excel",
      })
    }
  },
)

router.post(
  "/create",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const { category, name, score_delta } = req.body
    let ruleCode
    try {
      ruleCode = normalizeRuleCode(req.body?.rule_code)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message })
    }

    if (!category || !name) {
      return res.status(400).json({ error: "Missing data" })
    }

    db.run(
      `
        INSERT INTO rules(rule_code,category,name,score_delta)
        VALUES(?,?,?,?)
      `,
      [ruleCode, category, name, score_delta || 0],
      function onCreate(err) {
        if (err) {
          return res.status(500).json({ error: err.message })
        }

        res.json({ success: true })
      },
    )
  },
)

router.patch(
  "/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    const { category, name, score_delta } = req.body
    let ruleCode
    try {
      ruleCode = normalizeRuleCode(req.body?.rule_code)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message })
    }

    db.run(
      `
        UPDATE rules
        SET rule_code=?, category=?, name=?, score_delta=?
        WHERE id=?
      `,
      [ruleCode, category, name, score_delta, req.params.id],
      function onUpdate(err) {
        if (err) {
          return res.status(500).json({ error: err.message })
        }

        res.json({ success: true })
      },
    )
  },
)

router.delete(
  "/:id",
  requireLogin,
  requireRole(["admin"]),
  (req, res) => {
    db.run(
      "DELETE FROM rules WHERE id=?",
      [req.params.id],
      function onDelete(err) {
        if (err) {
          if (isForeignKeyError(err)) {
            return res.status(409).json({
              error: "Không thể xóa lỗi vi phạm vì đã được dùng trong phiếu trực (cần xóa hoặc sửa phiếu trước)",
            })
          }

          const out = mapDatabaseError(err, err.message)
          return res.status(out.status).json({ error: out.error })
        }

        res.json({ success: true })
      },
    )
  },
)

module.exports = router
