const codoParseSchema = { "type": "object", "additionalProperties": false, "properties": { "violations": { "type": "array", "items": { "type": "object", "additionalProperties": false, "properties": { "ruleId": { "type": "integer" }, "quantity": { "type": "integer", "minimum": 1 }, "confidence": { "type": "number", "minimum": 0, "maximum": 1 }, "matchedText": { "type": "string" } }, "required": ["ruleId", "quantity"] } } }, "required": ["violations"] }

module.exports = {
  codoParseSchema,
}
