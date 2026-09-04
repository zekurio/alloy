import { user } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { eq } from "drizzle-orm"
import type { Context } from "hono"

import { beginAccountReactivation } from "./account-reactivation"
import { accountSignInState } from "./account-state"
import {
  clearAccountReactivationCookie,
  setAccountReactivationCookie,
  setSessionCookies,
} from "./cookies"
import {
  createSession,
  type CreatedSession,
  InactiveAccountError,
} from "./session"

export type AuthenticatedSignInResult =
  | { kind: "session"; session: CreatedSession }
  | { kind: "reactivation-required" }
  | { kind: "banned" }

export async function completeAuthenticatedSignIn(
  c: Context,
  userId: string,
): Promise<AuthenticatedSignInResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [account] = await db
      .select({
        status: user.status,
        disabledAt: user.disabled_at,
        adminSuspendedAt: user.admin_suspended_at,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!account) throw new Error("Account not found.")

    const state = accountSignInState(account)
    if (state === "banned") {
      clearAccountReactivationCookie(c)
      return { kind: "banned" }
    }
    if (state === "reactivation-required") {
      const token = await beginAccountReactivation(userId)
      setAccountReactivationCookie(c, token)
      return { kind: "reactivation-required" }
    }

    try {
      const session = await createSession(c, userId)
      clearAccountReactivationCookie(c)
      setSessionCookies(c, session.tokens)
      return { kind: "session", session }
    } catch (cause) {
      if (cause instanceof InactiveAccountError) continue
      throw cause
    }
  }

  throw new Error("Account state changed during sign-in. Try again.")
}
