import { and, eq, gt, lt } from "drizzle-orm"

import { authChallenge } from "@workspace/db/auth-schema"

import { db } from "../db"

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_PURPOSE = "oauth-state"

export async function deleteExpiredOAuthChallenges(): Promise<void> {
  await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, OAUTH_PURPOSE),
        lt(authChallenge.expiresAt, new Date())
      )
    )
}

export async function consumeOAuthChallenge(state: string) {
  const [challenge] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, OAUTH_PURPOSE),
        eq(authChallenge.identifier, state),
        eq(authChallenge.challenge, state),
        gt(authChallenge.expiresAt, new Date())
      )
    )
    .returning()
  if (!challenge) throw new Error("OAuth sign-in expired. Try again.")
  return challenge
}
