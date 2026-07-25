type DutyViolation = {
  quantity?: number | string
  exempted_quantity?: number | string
  effective_quantity?: number | string
  score_delta?: number | string
}

export function effectiveViolationQuantity(violation: DutyViolation) {
  const effective = Number(violation.effective_quantity)
  if (Number.isFinite(effective)) return Math.max(0, effective)

  return Math.max(0, Number(violation.quantity || 0) - Number(violation.exempted_quantity || 0))
}

export function exemptedViolationQuantity(violation: DutyViolation) {
  return Math.max(0, Number(violation.exempted_quantity || 0))
}

export function effectiveViolationScore(violation: DutyViolation) {
  return Number(violation.score_delta || 0) * effectiveViolationQuantity(violation)
}

export function violationQuantityLabel(violation: DutyViolation) {
  const effective = effectiveViolationQuantity(violation)
  const exempted = exemptedViolationQuantity(violation)
  if (!exempted) return `x${effective}`
  if (!effective) return `x${violation.quantity || 0} - Đã miễn trừ`
  return `x${effective} còn hiệu lực, đã miễn trừ ${exempted}`
}
