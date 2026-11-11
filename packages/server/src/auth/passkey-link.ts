import type { PasskeyLink } from "@alloy/contracts"
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

// A passkey link lets its holder create a passkey without signing in first.
// An invite has no account: the holder picks a username and the passkey
// creates the account, also while registrations are closed. A link for an
// account adds a passkey to it, for someone who lost theirs. An admin makes
// both. The server stores only the token's hash, and using a link deletes it.
const PURPOSE = "passkey-link"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export const PASSKEY_LINK_INVALID = "This link has expired or was already used."

/**
 * Make an invite, or with `userId` a link for that account, which replaces
 * the one the account had.
 */
export async function createPasskeyLink(
  userId: string | null,
): Promise<PasskeyLink> {
  const token = randomBase64Url(32)
  const hash = await sha256Base64Url(token)
  if (userId) {
    await db
      .delete(authChallenge)
      .where(
        and(
          eq(authChallenge.purpose, PURPOSE),
          eq(authChallenge.user_id, userId),
        ),
      )
  }
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

/** The link a token belongs to. `user` is null for an invite. */
export async function findPasskeyLink(token: string): Promise<{
  id: string
  user: { id: string; username: string } | null
} | null> {
  const hash = await sha256Base64Url(token)
  const link = await findAuthChallenge({
    purpose: PURPOSE,
    identifier: hash,
    challenge: hash,
  })
  if (!link) return null
  if (!link.user_id) return { id: link.id, user: null }
  const [account] = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(eq(user.id, link.user_id))
    .limit(1)
  return account ? { id: link.id, user: account } : null
}

/** Use the link up inside `tx`. False when it is gone or expired. */
export async function consumePasskeyLink(
  tx: DbTransaction,
  id: string,
): Promise<boolean> {
  return (await consumeAuthChallenge({ purpose: PURPOSE, id }, tx)) !== null
}
