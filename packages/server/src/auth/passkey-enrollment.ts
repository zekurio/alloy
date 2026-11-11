import type { PasskeyEnrollmentLink } from "@alloy/contracts"
import { authChallenge, user } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { env } from "@alloy/server/env"
import { randomBase64Url, sha256Base64Url } from "@alloy/server/runtime/crypto"
import { and, eq } from "drizzle-orm"

import {
  consumeAuthChallenge,
  findAuthChallenge,
  insertAuthChallenge,
} from "./challenges"

// A passkey link lets its holder add a passkey to one account without
// signing in first. An admin makes one for an account that has no sign-in
// method yet, or whose owner lost their passkeys. The server stores only the
// token's hash. An account has one link at a time, and using it deletes it.
const PURPOSE = "passkey-enrollment"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export const PASSKEY_LINK_INVALID =
  "This passkey link has expired or was already used."

/** Replace the user's passkey link with a new one. */
export async function createPasskeyEnrollment(
  userId: string,
): Promise<PasskeyEnrollmentLink> {
  const token = randomBase64Url(32)
  const hash = await sha256Base64Url(token)
  await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, PURPOSE),
        eq(authChallenge.user_id, userId),
      ),
    )
  await insertAuthChallenge({
    purpose: PURPOSE,
    identifier: hash,
    challenge: hash,
    payload: {},
    userId,
    ttlMs: TTL_MS,
  })
  // The token goes in the fragment, which browsers keep out of requests, so
  // no proxy or access log records it.
  const url = new URL("/enroll", env.PUBLIC_SERVER_URL)
  url.hash = token
  return {
    url: url.toString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
  }
}

/** The link a token belongs to and the account it adds a passkey to. */
export async function findPasskeyEnrollment(
  token: string,
): Promise<{ id: string; user: { id: string; username: string } } | null> {
  const hash = await sha256Base64Url(token)
  const link = await findAuthChallenge({
    purpose: PURPOSE,
    identifier: hash,
    challenge: hash,
  })
  if (!link?.user_id) return null
  const [account] = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(eq(user.id, link.user_id))
    .limit(1)
  return account ? { id: link.id, user: account } : null
}

/** Use the link up inside `tx`. False when it is gone or expired. */
export async function consumePasskeyEnrollment(
  tx: DbTransaction,
  id: string,
): Promise<boolean> {
  return (await consumeAuthChallenge({ purpose: PURPOSE, id }, tx)) !== null
}
