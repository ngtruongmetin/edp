const express = require("express")
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require("@simplewebauthn/server")
const { pool } = require("../../config/database")
const requireLogin = require("../../middleware/requireLogin")

const router = express.Router()
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_DEVICE_NAME_LENGTH = 100
const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"])

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

function getWebAuthnConfig(req) {
  const configuredOrigin = String(process.env.WEBAUTHN_ORIGIN || "").trim()
  const configuredRpId = String(process.env.WEBAUTHN_RP_ID || "").trim()
  const isProduction = process.env.NODE_ENV === "production"
  const requestOrigin = String(req.get("origin") || "").trim()

  let localRequestOrigin
  try {
    const parsedRequestOrigin = new URL(requestOrigin)
    if (isLocalhost(parsedRequestOrigin.hostname)) {
      localRequestOrigin = parsedRequestOrigin
    }
  } catch {
    // The configured origin below produces the user-facing validation error.
  }

  if (isProduction && !localRequestOrigin && (!configuredOrigin || !configuredRpId)) {
    throw new Error("Passkey chưa được cấu hình. Hãy thiết lập WEBAUTHN_ORIGIN và WEBAUTHN_RP_ID.")
  }

  const origin = localRequestOrigin?.origin || configuredOrigin || requestOrigin || String(process.env.BACKEND_ORIGIN || "").trim()

  let parsedOrigin
  try {
    parsedOrigin = new URL(origin)
  } catch {
    throw new Error("Cấu hình origin của Passkey không hợp lệ.")
  }

  const allowsLocalHttp = isLocalhost(parsedOrigin.hostname)
  if (parsedOrigin.protocol !== "https:" && !allowsLocalHttp) {
    throw new Error("Passkey yêu cầu HTTPS khi không chạy trên localhost.")
  }

  return {
    origin: parsedOrigin.origin,
    rpID: localRequestOrigin?.hostname || configuredRpId || parsedOrigin.hostname,
    rpName: String(process.env.WEBAUTHN_RP_NAME || "EduDiscipline Platform").trim(),
  }
}

function ensureSecureContext(req, res, next) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim()
  const host = String(req.hostname || "").toLowerCase()
  const requestOrigin = String(req.get("origin") || "").trim()
  const isSecure = req.secure || forwardedProto === "https"
  let isLocalOrigin = false

  try {
    const parsedOrigin = new URL(requestOrigin)
    isLocalOrigin = isLocalhost(parsedOrigin.hostname)
    if (!isLocalhost(parsedOrigin.hostname) && parsedOrigin.protocol !== "https:") {
      return res.status(400).json({ error: "Passkey yêu cầu kết nối HTTPS." })
    }
  } catch {
    if (requestOrigin) {
      return res.status(400).json({ error: "Origin của Passkey không hợp lệ." })
    }
  }

  const allowsLocalHttp = isLocalOrigin || (!requestOrigin && isLocalhost(host))
  if (process.env.NODE_ENV === "production" && !isSecure && !allowsLocalHttp) {
    return res.status(400).json({ error: "Passkey yêu cầu kết nối HTTPS." })
  }

  if (!isSecure && !allowsLocalHttp) {
    return res.status(400).json({ error: "Passkey yêu cầu kết nối HTTPS." })
  }

  next()
}

function validChallenge(challenge) {
  return Boolean(challenge && Date.now() - Number(challenge.createdAt || 0) <= CHALLENGE_TTL_MS)
}

function normalizeTransports(value) {
  if (!Array.isArray(value)) return []
  return value.filter((transport) => typeof transport === "string" && TRANSPORTS.has(transport))
}

function parseTransports(value) {
  try {
    return normalizeTransports(JSON.parse(String(value || "[]")))
  } catch {
    return []
  }
}

function normalizeDeviceName(value, userAgent) {
  const supplied = String(value || "").replace(/[\r\n]/g, " ").trim()
  if (supplied) return supplied.slice(0, MAX_DEVICE_NAME_LENGTH)

  const agent = String(userAgent || "")
  if (/iPhone/i.test(agent)) return "iPhone"
  if (/iPad/i.test(agent)) return "iPad"
  const pixel = agent.match(/Pixel(?:\s+[\w-]+)?/i)
  if (pixel) return pixel[0]
  const samsung = agent.match(/SM-[\w-]+/i)
  if (samsung) return `Samsung Galaxy (${samsung[0]})`
  if (/Android/i.test(agent)) return "Thiết bị Android"
  if (/Windows/i.test(agent)) return "Windows Hello"
  if (/Macintosh|Mac OS X/i.test(agent)) return "MacBook"
  return "Thiết bị không xác định"
}

async function getPasskeyUser(sessionUser) {
  if (sessionUser?.role === "admin" && sessionUser.username) {
    const result = await pool.query(
      `SELECT id, username FROM admins WHERE username = $1 LIMIT 1`,
      [sessionUser.username],
    )
    const admin = result.rows[0]
    if (!admin) return null
    return {
      id: `admin:${admin.id}`,
      name: admin.username,
      displayName: admin.username,
      sessionUser: { role: "admin", username: admin.username },
    }
  }

  const role = String(sessionUser?.role || "")
  const classId = Number(sessionUser?.class_id)
  if (!classId || !["gvcn", "bancansu", "co_do"].includes(role)) return null

  const result = await pool.query(
    `SELECT a.id, a.class_id, c.name AS class_name
     FROM accounts a
     JOIN classes c ON c.id = a.class_id
     WHERE a.class_id = $1
     LIMIT 1`,
    [classId],
  )
  const account = result.rows[0]
  if (!account) return null

  return {
    id: `account:${account.id}:${role}`,
    name: `${account.class_name}-${role}`,
    displayName: `${account.class_name} (${role})`,
    sessionUser: { class_id: account.class_id, class_name: account.class_name, role },
  }
}

async function getUserForPasskeyId(userId) {
  const adminMatch = /^admin:(\d+)$/.exec(String(userId || ""))
  if (adminMatch) {
    const result = await pool.query(`SELECT username FROM admins WHERE id = $1 LIMIT 1`, [Number(adminMatch[1])])
    const admin = result.rows[0]
    return admin ? { role: "admin", username: admin.username } : null
  }

  const accountMatch = /^account:(\d+):(gvcn|bancansu|co_do)$/.exec(String(userId || ""))
  if (!accountMatch) return null

  const result = await pool.query(
    `SELECT a.class_id, c.name AS class_name
     FROM accounts a
     JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1
     LIMIT 1`,
    [Number(accountMatch[1])],
  )
  const account = result.rows[0]
  return account
    ? { class_id: account.class_id, class_name: account.class_name, role: accountMatch[2] }
    : null
}

async function establishSession(req, user) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  })
  req.session.user = user
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()))
  })
}

router.post("/register/options", requireLogin, ensureSecureContext, async (req, res) => {
  try {
    const config = getWebAuthnConfig(req)
    const user = await getPasskeyUser(req.session.user)
    if (!user) return res.status(401).json({ error: "Không thể xác định tài khoản hiện tại." })

    const existing = await pool.query(
      `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1`,
      [user.id],
    )
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: user.name,
      userID: Buffer.from(user.id, "utf8"),
      userDisplayName: user.displayName,
      timeout: 60_000,
      attestationType: "none",
      excludeCredentials: existing.rows.map((row) => ({
        id: row.credential_id,
        transports: parseTransports(row.transports),
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      preferredAuthenticatorType: "localDevice",
    })

    req.session.passkeyRegistration = {
      challenge: options.challenge,
      createdAt: Date.now(),
      userId: user.id,
      deviceName: normalizeDeviceName(req.body?.device_name, req.get("user-agent")),
    }
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())))
    res.json(options)
  } catch (err) {
    console.error("[passkeys/register/options]", err)
    res.status(500).json({ error: "Không thể tạo yêu cầu đăng ký Passkey." })
  }
})

router.post("/register/verify", requireLogin, ensureSecureContext, async (req, res) => {
  const challenge = req.session.passkeyRegistration
  delete req.session.passkeyRegistration

  try {
    if (!validChallenge(challenge)) {
      return res.status(400).json({ error: "Yêu cầu đăng ký Passkey đã hết hạn. Vui lòng thử lại." })
    }
    const config = getWebAuthnConfig(req)
    const user = await getPasskeyUser(req.session.user)
    if (!user || user.id !== challenge.userId) {
      return res.status(401).json({ error: "Tài khoản hiện tại không khớp với yêu cầu đăng ký Passkey." })
    }
    if (!req.body?.response || typeof req.body.response !== "object") {
      return res.status(400).json({ error: "Phản hồi đăng ký Passkey không hợp lệ." })
    }

    const verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    })
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Không thể xác thực đăng ký Passkey." })
    }

    const credential = verification.registrationInfo.credential
    const transports = normalizeTransports(req.body.response.response?.transports || credential.transports)
    const result = await pool.query(
      `INSERT INTO user_passkeys
       (user_id, credential_id, public_key, counter, device_name, transports)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, device_name, created_at, last_used_at`,
      [
        user.id,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        challenge.deviceName,
        JSON.stringify(transports),
      ],
    )
    res.status(201).json({ success: true, passkey: result.rows[0] })
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Thiết bị này đã được đăng ký Passkey." })
    }
    console.error("[passkeys/register/verify]", err)
    res.status(400).json({ error: "Không thể xác thực đăng ký Passkey." })
  } finally {
    req.session.save(() => {})
  }
})

router.post("/login/options", ensureSecureContext, async (req, res) => {
  try {
    const config = getWebAuthnConfig(req)
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      timeout: 60_000,
      userVerification: "required",
    })
    req.session.passkeyAuthentication = { challenge: options.challenge, createdAt: Date.now() }
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())))
    res.json(options)
  } catch (err) {
    console.error("[passkeys/login/options]", err)
    res.status(500).json({ error: "Không thể tạo yêu cầu đăng nhập bằng Passkey." })
  }
})

router.post("/login/verify", ensureSecureContext, async (req, res) => {
  const challenge = req.session.passkeyAuthentication
  delete req.session.passkeyAuthentication

  try {
    if (!validChallenge(challenge)) {
      return res.status(400).json({ error: "Yêu cầu đăng nhập bằng Passkey đã hết hạn. Vui lòng thử lại." })
    }
    if (!req.body?.response || typeof req.body.response !== "object") {
      return res.status(400).json({ error: "Phản hồi đăng nhập bằng Passkey không hợp lệ." })
    }
    const credentialId = String(req.body.response.id || "")
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(credentialId)) {
      return res.status(400).json({ error: "Phản hồi đăng nhập bằng Passkey không hợp lệ." })
    }
    const record = await pool.query(
      `SELECT id, user_id, credential_id, public_key, counter, transports
       FROM user_passkeys
       WHERE credential_id = $1
       LIMIT 1`,
      [credentialId],
    )
    const passkey = record.rows[0]
    if (!passkey) return res.status(401).json({ error: "Không tìm thấy Passkey." })

    const config = getWebAuthnConfig(req)
    const verification = await verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: parseTransports(passkey.transports),
      },
    })
    if (!verification.verified) {
      return res.status(401).json({ error: "Xác thực Passkey thất bại." })
    }

    const user = await getUserForPasskeyId(passkey.user_id)
    if (!user) return res.status(401).json({ error: "Tài khoản của Passkey này không còn khả dụng." })

    await pool.query(
      `UPDATE user_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2`,
      [verification.authenticationInfo.newCounter, passkey.id],
    )
    await establishSession(req, user)
    res.json({ success: true, role: user.role })
  } catch (err) {
    console.error("[passkeys/login/verify]", err)
    res.status(400).json({ error: "Xác thực Passkey thất bại." })
  } finally {
    req.session.save(() => {})
  }
})

router.get("/", requireLogin, async (req, res) => {
  try {
    const user = await getPasskeyUser(req.session.user)
    if (!user) return res.status(401).json({ error: "Không thể xác định tài khoản hiện tại." })
    const result = await pool.query(
      `SELECT id, device_name, transports, created_at, last_used_at
       FROM user_passkeys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id],
    )
    res.json(result.rows.map((row) => ({ ...row, transports: parseTransports(row.transports) })))
  } catch (err) {
    console.error("[passkeys/list]", err)
    res.status(500).json({ error: "Không thể tải danh sách Passkey." })
  }
})

router.delete("/:id", requireLogin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Mã Passkey không hợp lệ." })

  try {
    const user = await getPasskeyUser(req.session.user)
    if (!user) return res.status(401).json({ error: "Không thể xác định tài khoản hiện tại." })
    const result = await pool.query(
      `DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    )
    if (result.rowCount === 0) return res.status(404).json({ error: "Không tìm thấy Passkey." })
    res.json({ success: true })
  } catch (err) {
    console.error("[passkeys/delete]", err)
    res.status(500).json({ error: "Không thể xóa Passkey." })
  }
})

module.exports = router
