const bcrypt = require("bcrypt")

const BCRYPT_PIN_REGEX = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

function isHashedPin(value) {
  return BCRYPT_PIN_REGEX.test(String(value || ""))
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin), 12)
}

module.exports = {
  hashPin,
  isHashedPin,
}
