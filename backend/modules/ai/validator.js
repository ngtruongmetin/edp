const Ajv = require("ajv")

const { codoParseSchema } = require("./schema")

const ajv = new Ajv({
  allErrors: true,
  strict: false,
})

const validateCodoParseResponse = ajv.compile(codoParseSchema)

module.exports = {
  validateCodoParseResponse,
}
