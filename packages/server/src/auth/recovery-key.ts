import type { NewRecoveryKey } from "@alloy/contracts"
import { authSession, userRecoveryKey } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import {
  constantTimeEqual,
  sha256Base64Url,
} from "@alloy/server/runtime/crypto"
import { and, eq } from "drizzle-orm"

import { insertUserPasskey } from "./passkeys"
import type { VerifiedPasskeyRegistration } from "./webauthn"

// A recovery key gets someone back into an account after they lose every
// passkey: with the username and the key they create a new passkey and are
// signed in. There is one key per account. It is shown once, when it is made,
// and the server keeps only its hash. Using it replaces it, so a key works
// once.

// Crockford base32: no I, L, O or U, so a key survives being read aloud or
// copied by hand.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
// Compared against when there is no key, so a missing account or key takes
// as long to refuse as a wrong key.
const DUMMY_HASH = "0".repeat(43)
export const RECOVERY_KEY_MISMATCH =
  "That username and recovery key do not match."

/**
 * A typed key as it was generated: upper case, without spaces and hyphens,
 * and with the letters the alphabet leaves out read as the digits they look
 * like. Null when that is not a whole key.
 */
function normalizeRecoveryKey(value: string): string | null {
  const normalized = value
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
  return /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{32}$/.test(normalized)
    ? normalized
    : null
}

/**
 * The hash of a presented key when it is the stored one, else null.
 * `storedHash` is null for an account without a key, or no account.
 */
export async function recoveryKeyMatches(
  value: string,
  storedHash: string | null,
): Promise<string | null> {
  const normalized = normalizeRecoveryKey(value)
  const hash = await sha256Base64Url(normalized ?? "")
  const encoder = new TextEncoder()
  const matches = constantTimeEqual(
    encoder.encode(hash),
    encoder.encode(storedHash ?? DUMMY_HASH),
  )
  return normalized && storedHash && matches ? hash : null
}

async function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let bits = 0
  let buffer = 0
  let normalized = ""
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      normalized += ALPHABET[(buffer >>> bits) & 31]
    }
  }
  // The key has 160 bits of entropy, so SHA-256 needs no slow password hash.
  const hash = await sha256Base64Url(normalized)
  const key: NewRecoveryKey = {
    recoveryKey: normalized.match(/.{4}/g)!.join("-"),
    createdAt: new Date().toISOString(),
  }
  return { hash, key }
}

/** Make the user a key, in place of the one they had. */
export async function replaceRecoveryKey(
  userId: string,
): Promise<NewRecoveryKey> {
  const { hash, key } = await generateRecoveryKey()
  const values = {
    user_id: userId,
    secret_hash: hash,
    created_at: new Date(key.createdAt),
  }
  await db
    .insert(userRecoveryKey)
    .values(values)
    .onConflictDoUpdate({ target: userRecoveryKey.user_id, set: values })
  return key
}

/**
 * Finish a recovery: swap the key that was presented for a new one, add the
 * passkey, and end the account's sessions, since whoever lost the passkeys
 * may have lost a signed-in device with them. The swap only happens while
 * the presented key is still the stored one, so of two recoveries started on
 * one key, one wins.
 */
export async function recoverAccount(input: {
  userId: string
  recoveryHash: string
  registration: VerifiedPasskeyRegistration
}): Promise<NewRecoveryKey> {
  const { hash, key } = await generateRecoveryKey()
  await db.transaction(async (tx) => {
    const [changed] = await tx
      .update(userRecoveryKey)
      .set({ secret_hash: hash, created_at: new Date(key.createdAt) })
      .where(
        and(
          eq(userRecoveryKey.user_id, input.userId),
          eq(userRecoveryKey.secret_hash, input.recoveryHash),
        ),
      )
      .returning({ userId: userRecoveryKey.user_id })
    if (!changed) throw new Error(RECOVERY_KEY_MISMATCH)
    await insertUserPasskey(tx, {
      userId: input.userId,
      registration: input.registration,
      name: null,
    })
    await tx.delete(authSession).where(eq(authSession.user_id, input.userId))
  })
  return key
}
