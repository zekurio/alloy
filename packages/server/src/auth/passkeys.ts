import { type User, type UserPasskey, userPasskey } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq } from "drizzle-orm"

import { withAdminAccessChange } from "./admin-access"
import { createRegistrationUserInTransaction } from "./identity"
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

/** Create the account a passkey sign-up registered, together with its passkey. */
export async function createPasskeyAccount(input: {
  username: string
  setupFirstAdmin: boolean
  registration: VerifiedPasskeyRegistration
}): Promise<User> {
  const create = () =>
    db.transaction(async (tx) => {
      const row = await createRegistrationUserInTransaction(tx, {
        username: input.username,
        setupFirstAdmin: input.setupFirstAdmin,
      })
      await insertUserPasskey(tx, {
        userId: row.id,
        registration: input.registration,
        name: `${row.username}'s passkey`,
      })
      return row
    })
  return input.setupFirstAdmin ? withAdminAccessChange(create) : create()
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
