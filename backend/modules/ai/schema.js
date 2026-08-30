const codoParseSchema = { "type": "object", "additionalProperties": false, "properties": { "violations": { "type": "array", "items": { "type": "object", "additionalProperties": false, "properties": { "ruleCode": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]{1,63}$" }, "quantity": { "type": "integer", "minimum": 1 }, "studentName": { "type": "string", "minLength": 1 }, "confidence": { "type": "number", "minimum": 0, "maximum": 1 }, "matchedText": { "type": "string" } }, "required": ["ruleCode", "quantity", "studentName"] } } }, "required": ["violations"] }

module.exports = {
  codoParseSchema,
}
