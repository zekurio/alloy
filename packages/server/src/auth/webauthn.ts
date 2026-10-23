import { Buffer } from "node:buffer"

import { t } from "@alloy/contracts/schema"
import {
  type AuthChallengePayload,
  type User,
  type UserPasskey,
  userPasskey,
} from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  type Uint8Array_,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { eq } from "drizzle-orm"

import { consumeAuthChallenge, insertAuthChallenge } from "./challenges"
import { base64UrlToBytes, bytesToBase64Url } from "./tokens"
import {
  webAuthnChallengeContext,
  type WebAuthnChallengeContext,
} from "./webauthn-origin"

const RP_NAME = "alloy"
const REGISTRATION_TTL_MS = 15 * 60 * 1000
const AUTHENTICATION_TTL_MS = 5 * 60 * 1000
const WebAuthnContextPayloadSchema = t.object({
  webAuthnOrigin: t.string(),
  webAuthnRpId: t.string(),
})
const RegistrationPayloadSchema = t.object({
  setupFirstAdmin: t.boolean().optional(),
  userId: t.string().optional(),
  username: t.string().optional(),
})

type RegistrationPayload = {
  setupFirstAdmin?: boolean
  userId?: string
  username?: string
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

function transports(row: UserPasskey): string[] | undefined {
  return row.transports
    ? row.transports
        .split(",")
        .map((part) => part.trim())
        .filter((part) => AUTHENTICATOR_TRANSPORTS.has(part))
    : undefined
}

async function consumeChallenge(input: {
  challengeId: string
  purpose: string
  expiredMessage: string
}) {
  const challenge = await consumeAuthChallenge({
    purpose: input.purpose,
    id: input.challengeId,
  })
  if (!challenge) throw new Error(input.expiredMessage)
  return challenge
}

export async function beginPasskeyRegistration(input: {
  identifier: string
  origin?: string
  payload: RegistrationPayload
  user: Pick<User, "id" | "username"> & {
    passkeys?: UserPasskey[]
  }
}) {
  const context = currentWebAuthnContext(input.origin)
  const excludeCredentials =
    input.user.passkeys?.map((row) => ({
      id: row.credential_id,
      transports: transports(row),
    })) ?? []
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: context.rpId,
    userID: Buffer.from(input.user.id, "utf8"),
    userName: input.user.username,
    userDisplayName: input.user.username,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  })
  const challengeId = await insertAuthChallenge({
    purpose: "passkey-registration",
    identifier: input.identifier,
    challenge: options.challenge,
    payload: challengePayload(input.payload, context),
    // Ties a challenge for an existing account to it, so account deletion
    // removes it. Sign-up has no account yet.
    userId: input.payload.userId ?? null,
    ttlMs: REGISTRATION_TTL_MS,
  })
  return { challengeId, options }
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
  const context = webAuthnContextFromPayload(challenge.payload)

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: context?.origin ?? env.TRUSTED_ORIGINS,
    expectedRPID: context?.rpId ?? new URL(env.PUBLIC_SERVER_URL).hostname,
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

export async function beginPasskeyAuthentication(
  input: { origin?: string } = {},
) {
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-in is currently disabled.")
  }
  const context = currentWebAuthnContext(input.origin)
  const options = await generateAuthenticationOptions({
    rpID: context.rpId,
    userVerification: "required",
  })
  const challengeId = await insertAuthChallenge({
    purpose: "passkey-authentication",
    identifier: "discoverable",
    challenge: options.challenge,
    payload: challengePayload({}, context),
    userId: null,
    ttlMs: AUTHENTICATION_TTL_MS,
  })
  return { challengeId, options }
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
  const context = webAuthnContextFromPayload(challenge.payload)

  const [credential] = await db
    .select({ passkey: userPasskey })
    .from(userPasskey)
    .where(eq(userPasskey.credential_id, input.response.id))
    .limit(1)
  if (!credential) throw new Error("Passkey is not registered.")

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: context?.origin ?? env.TRUSTED_ORIGINS,
    expectedRPID: context?.rpId ?? new URL(env.PUBLIC_SERVER_URL).hostname,
    credential: {
      id: credential.passkey.credential_id,
      // SAFETY: The decoder returns Uint8Array bytes, which is the library's
      // runtime credential public-key representation.
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

function currentWebAuthnContext(
  origin: string | undefined,
): WebAuthnChallengeContext {
  return webAuthnChallengeContext({
    publicServerUrl: env.PUBLIC_SERVER_URL,
    requestOrigin: origin,
    trustedOrigins: env.TRUSTED_ORIGINS,
  })
}

function challengePayload(
  payload: AuthChallengePayload,
  context: WebAuthnChallengeContext,
) {
  return {
    ...payload,
    webAuthnOrigin: context.origin,
    webAuthnRpId: context.rpId,
  }
}

function webAuthnContextFromPayload(
  payload: AuthChallengePayload,
): WebAuthnChallengeContext | null {
  if (
    payload.webAuthnOrigin === undefined &&
    payload.webAuthnRpId === undefined
  ) {
    return null
  }
  const parsed = WebAuthnContextPayloadSchema.safeParse(payload)
  if (parsed.success)
    return {
      origin: parsed.data.webAuthnOrigin,
      rpId: parsed.data.webAuthnRpId,
    }
  throw new Error("Passkey challenge payload is invalid.")
}

function requireRegistrationPayload(
  payload: AuthChallengePayload,
): RegistrationPayload {
  const parsed = RegistrationPayloadSchema.safeParse(payload)
  if (parsed.success) return parsed.data
  throw new Error("Passkey registration payload is invalid.")
}
