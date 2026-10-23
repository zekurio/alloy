import { randomBase64Url } from "@alloy/server/runtime/crypto"

import { consumeAuthChallenge, insertAuthChallenge } from "./challenges"

const ACCOUNT_REACTIVATION_PURPOSE = "account-reactivation"
const ACCOUNT_REACTIVATION_TTL_MS = 10 * 60 * 1000

export async function beginAccountReactivation(
  userId: string,
): Promise<string> {
  const token = randomBase64Url(32)
  await insertAuthChallenge({
    purpose: ACCOUNT_REACTIVATION_PURPOSE,
    identifier: token,
    challenge: token,
    payload: {},
    userId,
    ttlMs: ACCOUNT_REACTIVATION_TTL_MS,
  })
  return token
}

export async function consumeAccountReactivation(
  token: string,
): Promise<string | null> {
  const challenge = await consumeAuthChallenge({
    purpose: ACCOUNT_REACTIVATION_PURPOSE,
    identifier: token,
    challenge: token,
  })
  return challenge?.user_id ?? null
}
