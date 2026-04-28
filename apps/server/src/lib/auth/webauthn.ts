import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type Uint8Array_,
} from "@simplewebauthn/server"
import { and, eq, gt, lt } from "drizzle-orm"

import {
  authChallenge,
  user,
  userPasskey,
  type User,
  type UserPasskey,
} from "@workspace/db/auth-schema"

import { db } from "../../db"
import { env } from "../../env"
import { base64UrlToBytes, bytesToBase64Url } from "./tokens"

const RP_NAME = "alloy"
const REGISTRATION_TTL_MS = 15 * 60 * 1000
const AUTHENTICATION_TTL_MS = 5 * 60 * 1000

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
  value: string
): value is AuthenticatorTransportFuture {
  return AUTHENTICATOR_TRANSPORTS.has(value)
}

function transports(
  row: UserPasskey
): AuthenticatorTransportFuture[] | undefined {
  return row.transports
    ? row.transports
        .split(",")
        .map((part) => part.trim())
        .filter(isAuthenticatorTransport)
    : undefined
}

async function deleteExpiredChallenges(): Promise<void> {
  await db.delete(authChallenge).where(lt(authChallenge.expiresAt, new Date()))
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
        gt(authChallenge.expiresAt, new Date())
      )
    )
    .returning()
  if (!challenge) throw new Error(input.expiredMessage)
  return challenge
}

export async function beginPasskeyRegistration(input: {
  identifier: string
  payload: RegistrationPayload
  user: Pick<User, "id" | "email" | "name" | "username"> & {
    passkeys?: UserPasskey[]
  }
}) {
  await deleteExpiredChallenges()
  const excludeCredentials =
    input.user.passkeys?.map((row) => ({
      id: row.credentialId,
      transports: transports(row),
    })) ?? []
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: Buffer.from(input.user.id, "utf8"),
    userName: input.user.email,
    userDisplayName: input.user.name || input.user.username,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  })
  const [challenge] = await db
    .insert(authChallenge)
    .values({
      purpose: "passkey-registration",
      identifier: input.identifier,
      challenge: options.challenge,
      payload: input.payload,
      expiresAt: new Date(Date.now() + REGISTRATION_TTL_MS),
    })
    .returning()
  if (!challenge) throw new Error("Could not create passkey challenge.")
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
  return { payload: challenge.payload as RegistrationPayload, verification }
}

export async function beginPasskeyAuthentication() {
  await deleteExpiredChallenges()
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "required",
  })
  const [challenge] = await db
    .insert(authChallenge)
    .values({
      purpose: "passkey-authentication",
      identifier: "discoverable",
      challenge: options.challenge,
      payload: {},
      expiresAt: new Date(Date.now() + AUTHENTICATION_TTL_MS),
    })
    .returning()
  if (!challenge) throw new Error("Could not create passkey challenge.")
  return { challengeId: challenge.id, options }
}

export async function verifyPasskeyAuthentication(input: {
  challengeId: string
  response: AuthenticationResponseJSON
}) {
  const challenge = await consumeChallenge({
    challengeId: input.challengeId,
    purpose: "passkey-authentication",
    expiredMessage: "Passkey sign-in expired. Try again.",
  })

  const [credential] = await db
    .select({ passkey: userPasskey, owner: user })
    .from(userPasskey)
    .innerJoin(user, eq(user.id, userPasskey.userId))
    .where(eq(userPasskey.credentialId, input.response.id))
    .limit(1)
  if (!credential) throw new Error("Passkey is not registered.")

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expectedOrigins(),
    expectedRPID: rpId(),
    credential: {
      id: credential.passkey.credentialId,
      publicKey: base64UrlToBytes(credential.passkey.publicKey) as Uint8Array_,
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
  value: string[] | undefined
): string | null {
  return value && value.length > 0 ? value.join(",") : null
}
