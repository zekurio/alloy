import { constantTimeEqual } from "@alloy/server/runtime/crypto"

import { consumeAuthChallenge } from "./challenges"

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_PURPOSE = "oauth-state"

const textEncoder = new TextEncoder()

export async function consumeOAuthChallenge(state: string) {
  const challenge = await consumeAuthChallenge({
    purpose: OAUTH_PURPOSE,
    identifier: state,
    challenge: state,
  })
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
