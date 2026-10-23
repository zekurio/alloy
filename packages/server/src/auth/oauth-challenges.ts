import { authChallenge } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { constantTimeEqual } from "@alloy/server/runtime/crypto"
import { and, eq, gt } from "drizzle-orm"

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_PURPOSE = "oauth-state"

const textEncoder = new TextEncoder()

export async function consumeOAuthChallenge(state: string) {
  const [challenge] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, OAUTH_PURPOSE),
        eq(authChallenge.identifier, state),
        eq(authChallenge.challenge, state),
        gt(authChallenge.expires_at, new Date()),
      ),
    )
    .returning()
  if (!challenge) throw new Error("OAuth sign-in expired. Try again.")
  return challenge
}

/** Whether the state cookie carries the nonce stored with the challenge. */
export function browserNonceMatches(
  cookieNonce: string | null,
  storedNonce: string,
): boolean {
  return (
    cookieNonce !== null &&
    constantTimeEqual(
      textEncoder.encode(cookieNonce),
      textEncoder.encode(storedNonce),
    )
  )
}
