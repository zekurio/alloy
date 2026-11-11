import { type User, type UserPasskey, userPasskey } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq } from "drizzle-orm"

import { createUserIdentity } from "./identity"
import { consumePasskeyLink, PASSKEY_LINK_INVALID } from "./passkey-link"
import { createFirstAdmin } from "./setup"
import { bytesToBase64Url } from "./tokens"
import type { VerifiedPasskeyRegistration } from "./webauthn"

export function listUserPasskeys(userId: string) {
  return db
    .select({
      id: userPasskey.id,
      name: userPasskey.name,
      createdAt: userPasskey.created_at,
      deviceType: userPasskey.device_type,
    })
    .from(userPasskey)
    .where(eq(userPasskey.user_id, userId))
    .orderBy(userPasskey.created_at)
}

/** Full rows, for the exclude list of a new registration. */
export function selectUserPasskeys(userId: string): Promise<UserPasskey[]> {
  return db.select().from(userPasskey).where(eq(userPasskey.user_id, userId))
}

export async function insertUserPasskey(
  executor: typeof db | DbTransaction,
  input: {
    userId: string
    registration: VerifiedPasskeyRegistration
    name: string | null
  },
): Promise<UserPasskey> {
  const { info, transports } = input.registration
  const [created] = await executor
    .insert(userPasskey)
    .values({
      user_id: input.userId,
      credential_id: info.credential.id,
      public_key: bytesToBase64Url(info.credential.publicKey),
      counter: info.credential.counter,
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
      transports:
        transports && transports.length > 0 ? transports.join(",") : null,
      aaguid: info.aaguid,
      name: input.name,
    })
    .returning()
  if (!created) throw new Error("Passkey insert returned no row.")
  return created
}

/** Whether anyone may create an account with a username and a passkey. */
export function passkeySignUpOpen(): boolean {
  return (
    configStore.get("openRegistrations") && configStore.get("passkeyEnabled")
  )
}

/**
 * Create the account a passkey sign-up registered, together with its
 * passkey. `firstAdmin` makes it the admin that finishes setup. `inviteId`
 * is the invite that lets it in while registrations are closed, and is used
 * up with it.
 */
export async function createPasskeyAccount(input: {
  username: string
  firstAdmin: boolean
  inviteId: string | null
  registration: VerifiedPasskeyRegistration
}): Promise<User> {
  const create = async (tx: DbTransaction) => {
    const row = await createUserIdentity(tx, {
      username: input.username,
      role: input.firstAdmin ? "admin" : "user",
    })
    await insertUserPasskey(tx, {
      userId: row.id,
      registration: input.registration,
      name: `${row.username}'s passkey`,
    })
    return row
  }
  if (input.firstAdmin) return createFirstAdmin(create)
  const { inviteId } = input
  if (inviteId === null) {
    if (!passkeySignUpOpen()) {
      throw new Error("Passkey sign-up is currently disabled.")
    }
    return db.transaction(create)
  }
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  return db.transaction(async (tx) => {
    if (!(await consumePasskeyLink(tx, inviteId))) {
      throw new Error(PASSKEY_LINK_INVALID)
    }
    return create(tx)
  })
}

/**
 * Add the passkey registered through an account's passkey link and use the
 * link up. False when the link is gone or expired.
 */
export function enrollPasskey(input: {
  userId: string
  linkId: string
  registration: VerifiedPasskeyRegistration
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await consumePasskeyLink(tx, input.linkId))) return false
    await insertUserPasskey(tx, {
      userId: input.userId,
      registration: input.registration,
      name: null,
    })
    return true
  })
}

export async function renameUserPasskey(input: {
  userId: string
  passkeyId: string
  name: string | null
}): Promise<UserPasskey | null> {
  const [updated] = await db
    .update(userPasskey)
    .set({ name: input.name, updated_at: new Date() })
    .where(
      and(
        eq(userPasskey.id, input.passkeyId),
        eq(userPasskey.user_id, input.userId),
      ),
    )
    .returning()
  return updated ?? null
}

export async function recordPasskeyUse(
  passkeyId: string,
  counter: number,
): Promise<void> {
  const now = new Date()
  await db
    .update(userPasskey)
    .set({ counter, last_used_at: now, updated_at: now })
    .where(eq(userPasskey.id, passkeyId))
}
