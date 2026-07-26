import { compare } from "bcryptjs"

import { dutyStorage } from "./storage"
import type { DutyOfflineDataSnapshot, OfflineDutySession, OfflinePinAttemptState } from "./types"

const LOCKOUT_MS = 5 * 60 * 1000

function dataKey(ownerClass: string) {
  return `offline-data:${ownerClass}`
}

function attemptsKey(session: OfflineDutySession) {
  return `pin-attempts:${session.ownerClass}:${session.dutyClass}`
}

async function getAttemptState(session: OfflineDutySession) {
  const key = attemptsKey(session)
  return (await dutyStorage.getMetadata<OfflinePinAttemptState>(key)) ?? {
    key,
    failedAttempts: 0,
    lockedUntil: 0,
    updatedAt: new Date().toISOString(),
  }
}

async function saveAttemptState(state: OfflinePinAttemptState) {
  await dutyStorage.setMetadata(state.key, state)
}

export class OfflinePinVerifier {
  async authorize(session: OfflineDutySession, pin: string) {
    if (!/^\d{6}$/.test(pin)) throw new Error("INVALID_OFFLINE_PIN")

    const snapshot = await dutyStorage.getMetadata<DutyOfflineDataSnapshot>(dataKey(session.ownerClass))
    const committee = snapshot?.committees.find((item) => item.class_name === session.dutyClass)
    const validUntil = snapshot?.valid_until || (snapshot?.week?.end_date
      ? `${snapshot.week.end_date}T23:59:59+07:00`
      : "")
    const validUntilMs = Date.parse(validUntil)
    if (
      !snapshot ||
      snapshot.owner_class !== session.ownerClass ||
      !Number.isFinite(validUntilMs) ||
      Date.now() > validUntilMs ||
      !committee?.pin_hash
    ) {
      throw new Error("OFFLINE_DATA_NOT_READY")
    }

    const attemptState = await getAttemptState(session)
    if (attemptState.lockedUntil > Date.now()) throw new Error("OFFLINE_PIN_LOCKED")

    const matches = await compare(pin, committee.pin_hash)
    if (!matches) {
      const failedAttempts = Math.min(5, attemptState.failedAttempts + 1)
      await saveAttemptState({
        ...attemptState,
        failedAttempts,
        lockedUntil: failedAttempts >= 5 ? Date.now() + LOCKOUT_MS : 0,
        updatedAt: new Date().toISOString(),
      })
      throw new Error("INVALID_OFFLINE_PIN")
    }

    await saveAttemptState({
      ...attemptState,
      failedAttempts: 0,
      lockedUntil: 0,
      updatedAt: new Date().toISOString(),
    })
  }
}

export const offlinePinVerifier = new OfflinePinVerifier()
