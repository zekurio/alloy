import type { RegistrationResponseJSON } from "@simplewebauthn/server"
import { and, eq, sql } from "drizzle-orm"

import { user, userPasskey } from "@workspace/db/auth-schema"

import { db } from "../db"
import { configStore } from "../lib/config-store"
import { normalizeEmail, validateUsername } from "../lib/auth/identity"
import { passkeyPublicKey, serializeTransports } from "../lib/auth/webauthn"

type PasskeyRegistrationPayload = {
  email?: unknown
  username?: unknown
  setupFirstAdmin?: unknown
}

type PasskeyRegistrationInfo = {
  credential: {
    id: string
    publicKey: Uint8Array
    counter: number
  }
  credentialDeviceType: string
  credentialBackedUp: boolean
  aaguid: string
}

function newPasskeyUserValues(
  email: string,
  username: string,
  role: "admin" | "user"
) {
  return {
    email,
    emailVerified: true,
    username,
    name: username,
    role,
    storageQuotaBytes: configStore.get("limits").defaultStorageQuotaBytes,
  }
}

async function claimOrCreateSetupAdmin(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  email: string,
  username: string
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('alloy:first-admin-setup'))`)

  const existingAdminSignInMethod = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(userPasskey, eq(userPasskey.userId, user.id))
    .where(and(eq(user.role, "admin"), eq(user.status, "active")))
    .limit(1)

  if (existingAdminSignInMethod.length > 0) {
    throw new Error("Initial setup is already complete.")
  }
  const [existing] = await tx.select().from(user).where(eq(user.email, email)).limit(1)

  if (existing) {
    const now = new Date()
    const [updated] = await tx
      .update(user)
      .set({
        role: "admin",
        status: "active",
        disabledAt: null,
        username,
        name: existing.name || username,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id))
      .returning()
    if (!updated) throw new Error("Could not claim setup user.")
    return updated
  }

  const [created] = await tx
    .insert(user)
    .values(newPasskeyUserValues(email, username, "admin"))
    .returning()
  if (!created) throw new Error("Could not create user.")
  return created
}

async function createOpenRegistrationUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  email: string,
  username: string
) {
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (existing) {
    throw new Error("An account already exists for that email address.")
  }
  if (!configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }
  const [created] = await tx
    .insert(user)
    .values(newPasskeyUserValues(email, username, "user"))
    .returning()
  if (!created) throw new Error("Could not create user.")
  return created
}

export function completePasskeySignUp({
  payload,
  registrationInfo,
  response,
}: {
  payload: PasskeyRegistrationPayload
  registrationInfo: PasskeyRegistrationInfo
  response: RegistrationResponseJSON
}) {
  return db.transaction(async (tx) => {
    const email = normalizeEmail(String(payload.email ?? ""))
    const username = validateUsername(String(payload.username ?? ""))
    const setupFirstAdmin = payload.setupFirstAdmin === true
    const row = setupFirstAdmin
      ? await claimOrCreateSetupAdmin(tx, email, username)
      : await createOpenRegistrationUser(tx, email, username)

    await tx.insert(userPasskey).values({
      userId: row.id,
      credentialId: registrationInfo.credential.id,
      publicKey: passkeyPublicKey(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      transports: serializeTransports(response.response.transports),
      aaguid: registrationInfo.aaguid,
      name: `${row.username}'s passkey`,
    })

    return row
  })
}
