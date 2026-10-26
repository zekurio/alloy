import { randomUUID } from "node:crypto"

import { authChallenge, type AuthChallengePayload } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { and, eq, gt } from "drizzle-orm"

import { wakeAuthChallengeExpiryWorker } from "./challenge-expiry"

// Short-lived, single-use rows: OAuth state and pending links, WebAuthn
// challenges, desktop link codes, and account reactivation tokens. The expiry
// worker sweeps them.

type ChallengeMatch =
  | { purpose: string; id: string }
  | { purpose: string; identifier: string; challenge: string }

/** Store a challenge and return its id. */
export async function insertAuthChallenge(input: {
  purpose: string
  identifier: string
  challenge: string
  payload: AuthChallengePayload
  userId: string | null
  ttlMs: number
}): Promise<string> {
  const id = randomUUID()
  await db.insert(authChallenge).values({
    id,
    user_id: input.userId,
    purpose: input.purpose,
    identifier: input.identifier,
    challenge: input.challenge,
    payload: input.payload,
    expires_at: new Date(Date.now() + input.ttlMs),
  })
  // Startup and the periodic reconciliation pass cover inserts made before
  // the worker started.
  wakeAuthChallengeExpiryWorker()
  return id
}

/** Return the matching unexpired challenge without consuming it. */
export async function findAuthChallenge(match: ChallengeMatch) {
  const [row] = await db
    .select()
    .from(authChallenge)
    .where(unexpiredMatch(match))
    .limit(1)
  return row ?? null
}

/** Delete and return the matching unexpired challenge, if there is one. */
export async function consumeAuthChallenge(match: ChallengeMatch) {
  const [row] = await db
    .delete(authChallenge)
    .where(unexpiredMatch(match))
    .returning()
  return row ?? null
}

function unexpiredMatch(match: ChallengeMatch) {
  return and(
    eq(authChallenge.purpose, match.purpose),
    "id" in match
      ? eq(authChallenge.id, match.id)
      : and(
          eq(authChallenge.identifier, match.identifier),
          eq(authChallenge.challenge, match.challenge),
        ),
    gt(authChallenge.expires_at, new Date()),
  )
}
