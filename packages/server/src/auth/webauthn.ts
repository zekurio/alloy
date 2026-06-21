import { Buffer } from "node:buffer"

import {
  authChallenge,
  type User,
  type UserPasskey,
  userPasskey,
} from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  type Uint8Array_,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { and, eq, gt, lt } from "drizzle-orm"

import { base64UrlToBytes, bytesToBase64Url } from "./tokens"

const logger = createLogger("webauthn")

const RP_NAME = "alloy"
const REGISTRATION_TTL_MS = 15 * 60 * 1000
const AUTHENTICATION_TTL_MS = 5 * 60 * 1000
const CHALLENGE_SWEEP_INTERVAL_MS = 5 * 60 * 1000

type RegistrationPayload = {
  email?: string
  setupFirstAdmin?: boolean
  userId?: string
  username?: string
}

function rpId(): string {
  return new URL(env.PUBLIC_SERVER_URL).hostname
}

function expectedOrigins(): string[] {
  return env.TRUSTED_ORIGINS
}

const AUTHENTICATOR_TRANSPORTS = new Set<string>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
])

function isAuthenticatorTransport(
  value: string,
): value is AuthenticatorTransportFuture {
  return AUTHENTICATOR_TRANSPORTS.has(value)
}

function transports(
  row: UserPasskey,
): AuthenticatorTransportFuture[] | undefined {
  return row.transports
    ? row.transports
        .split(",")
        .map((part) => part.trim())
        .filter(isAuthenticatorTransport)
    : undefined
}

async function deleteExpiredChallenges(): Promise<void> {
  await db.delete(authChallenge).where(lt(authChallenge.expires_at, new Date()))
}

let sweepTimer: ReturnType<typeof setInterval> | null = null

function sweepExpiredChallenges(): void {
  void deleteExpiredChallenges().catch((err) =>
    logger.error("expired challenge sweep failed:", err),
  )
}

/**
 * Periodically purge expired challenges in the background. Keeping this OFF the
 * request path is what makes passkey sign-in fast: `consumeChallenge` already
 * rejects expired rows, so cleanup is pure housekeeping, not correctness.
 */
export function startChallengeSweeper(): void {
  if (sweepTimer) return
  sweepExpiredChallenges()
  sweepTimer = setInterval(sweepExpiredChallenges, CHALLENGE_SWEEP_INTERVAL_MS)
  // Don't keep the process alive just for the sweeper.
  sweepTimer.unref()
}

export function stopChallengeSweeper(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}

async function createChallenge(input: {
  purpose: string
  identifier: string
  challenge: string
  payload: Record<string, unknown>
  ttlMs: number
}): Promise<{ id: string }> {
  const [challenge] = await db
    .insert(authChallenge)
    .values({
      purpose: input.purpose,
      identifier: input.identifier,
      challenge: input.challenge,
      payload: input.payload,
      expires_at: new Date(Date.now() + input.ttlMs),
    })
    .returning({ id: authChallenge.id })
  if (!challenge) throw new Error("Could not create passkey challenge.")
  return challenge
}

async function consumeChallenge(input: {
  challengeId: string
  purpose: string
  expiredMessage: string
}) {
  const [challenge] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.id, input.challengeId),
        eq(authChallenge.purpose, input.purpose),
        gt(authChallenge.expires_at, new Date()),
      ),
    )
    .returning({
      challenge: authChallenge.challenge,
      payload: authChallenge.payload,
    })
  if (!challenge) throw new Error(input.expiredMessage)
  return challenge
}

export async function beginPasskeyRegistration(input: {
  identifier: string
  payload: RegistrationPayload
  user: Pick<User, "id" | "email" | "username"> & {
    passkeys?: UserPasskey[]
  }
}) {
  const excludeCredentials =
    input.user.passkeys?.map((row) => ({
      id: row.credential_id,
      transports: transports(row),
    })) ?? []
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: Buffer.from(input.user.id, "utf8"),
    userName: input.user.email,
    userDisplayName: input.user.username,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  })
  const challenge = await createChallenge({
    purpose: "passkey-registration",
    identifier: input.identifier,
    challenge: options.challenge,
    payload: input.payload,
    ttlMs: REGISTRATION_TTL_MS,
  })
  return { challengeId: challenge.id, options }
}

export async function verifyPasskeyRegistration(input: {
  challengeId: string
  response: RegistrationResponseJSON
}) {
  const challenge = await consumeChallenge({
    challengeId: input.challengeId,
    purpose: "passkey-registration",
    expiredMessage: "Passkey registration expired. Try again.",
  })

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expectedOrigins(),
    expectedRPID: rpId(),
    requireUserVerification: true,
  })
  if (!verification.verified) {
    throw new Error("Passkey registration failed.")
  }
  return {
    payload: requireRegistrationPayload(challenge.payload),
    verification,
  }
}

export async function beginPasskeyAuthentication() {
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-in is currently disabled.")
  }
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "required",
  })
  const challenge = await createChallenge({
    purpose: "passkey-authentication",
    identifier: "discoverable",
    challenge: options.challenge,
    payload: {},
    ttlMs: AUTHENTICATION_TTL_MS,
  })
  return { challengeId: challenge.id, options }
}

export async function verifyPasskeyAuthentication(input: {
  challengeId: string
  response: AuthenticationResponseJSON
}) {
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-in is currently disabled.")
  }
  const challenge = await consumeChallenge({
    challengeId: input.challengeId,
    purpose: "passkey-authentication",
    expiredMessage: "Passkey sign-in expired. Try again.",
  })

  const [credential] = await db
    .select({ passkey: userPasskey })
    .from(userPasskey)
    .where(eq(userPasskey.credential_id, input.response.id))
    .limit(1)
  if (!credential) throw new Error("Passkey is not registered.")

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expectedOrigins(),
    expectedRPID: rpId(),
    credential: {
      id: credential.passkey.credential_id,
      publicKey: base64UrlToBytes(credential.passkey.public_key) as Uint8Array_,
      counter: credential.passkey.counter,
      transports: transports(credential.passkey),
    },
    requireUserVerification: true,
  })
  if (!verification.verified) throw new Error("Passkey sign-in failed.")
  return { credential: credential.passkey, verification }
}

export function passkeyPublicKey(publicKey: Uint8Array): string {
  return bytesToBase64Url(publicKey)
}

export function serializeTransports(
  value: string[] | undefined,
): string | null {
  return value && value.length > 0 ? value.join(",") : null
}

function requireRegistrationPayload(
  payload: Record<string, unknown>,
): RegistrationPayload {
  if (
    (payload.email === undefined || typeof payload.email === "string") &&
    (payload.setupFirstAdmin === undefined ||
      typeof payload.setupFirstAdmin === "boolean") &&
    (payload.userId === undefined || typeof payload.userId === "string") &&
    (payload.username === undefined || typeof payload.username === "string")
  ) {
    return {
      email: payload.email,
      setupFirstAdmin: payload.setupFirstAdmin,
      userId: payload.userId,
      username: payload.username,
    }
  }
  throw new Error("Passkey registration payload is invalid.")
}
