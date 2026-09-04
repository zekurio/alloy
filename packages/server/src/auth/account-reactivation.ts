import { authChallenge } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { randomBase64Url } from "@alloy/server/runtime/crypto"
import { and, eq, gt } from "drizzle-orm"

import { insertAuthChallengeAndWake } from "./challenge-expiry"

const ACCOUNT_REACTIVATION_PURPOSE = "account-reactivation"
const ACCOUNT_REACTIVATION_TTL_MS = 10 * 60 * 1000

export async function beginAccountReactivation(
  userId: string,
): Promise<string> {
  const token = randomBase64Url(32)
  const [challenge] = await insertAuthChallengeAndWake(() =>
    db
      .insert(authChallenge)
      .values({
        user_id: userId,
        purpose: ACCOUNT_REACTIVATION_PURPOSE,
        identifier: token,
        challenge: token,
        payload: {},
        expires_at: new Date(Date.now() + ACCOUNT_REACTIVATION_TTL_MS),
      })
      .returning({ id: authChallenge.id }),
  )
  if (!challenge) throw new Error("Could not start account reactivation.")
  return token
}

export async function consumeAccountReactivation(
  token: string,
): Promise<string | null> {
  const [challenge] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, ACCOUNT_REACTIVATION_PURPOSE),
        eq(authChallenge.identifier, token),
        eq(authChallenge.challenge, token),
        gt(authChallenge.expires_at, new Date()),
      ),
    )
    .returning({ userId: authChallenge.user_id })
  return challenge?.userId ?? null
}
