import type { AccountRecovery, RecoveryKeyStatus } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { user, userRecoveryKey } from "@alloy/db/auth-schema"
import { completeAuthenticatedSignIn } from "@alloy/server/auth/account-sign-in"
import { accountSignInState } from "@alloy/server/auth/account-state"
import { selectUserPasskeys } from "@alloy/server/auth/passkeys"
import {
  RECOVERY_KEY_MISMATCH,
  recoverAccount,
  recoveryKeyMatches,
  replaceRecoveryKey,
} from "@alloy/server/auth/recovery-key"
import { publicSessionData } from "@alloy/server/auth/security-responses"
import { requireSession } from "@alloy/server/auth/session"
import { beginPasskeyRegistration } from "@alloy/server/auth/webauthn"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  badRequestFromCause,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import {
  PasskeyRegistrationVerifyBody,
  verifyRegistrationBody,
} from "./auth-passkey-routes"
import { authenticatedSignInResponse } from "./auth-route-helpers"
import { tbValidator } from "./validation"

const RecoveryOptionsBody = t.object({
  username: t.string().trim(),
  recoveryKey: t.string(),
})
const WINDOW_MS = 30 * 60 * 1000

export const authRecoveryRoutes = new Hono<{
  Variables: { recoveryUsername: string }
}>()
  .get("/recovery-key", requireSession, async (c) => {
    const [row] = await db
      .select({ createdAt: userRecoveryKey.created_at })
      .from(userRecoveryKey)
      .where(eq(userRecoveryKey.user_id, c.var.viewerId))
    const body: RecoveryKeyStatus = {
      createdAt: row?.createdAt.toISOString() ?? null,
    }
    return c.json(body)
  })
  .post("/recovery-key", requireSession, async (c) => {
    if (!configStore.get("passkeyEnabled"))
      return badRequest(c, "Passkey sign-in is currently disabled.")
    return c.json(await replaceRecoveryKey(c.var.viewerId))
  })
  .post(
    "/recovery/options",
    rateLimiter({ windowMs: WINDOW_MS, max: 10, key: requestIp }),
    tbValidator("json", RecoveryOptionsBody),
    async (c, next) => {
      c.set("recoveryUsername", c.req.valid("json").username.toLowerCase())
      await next()
    },
    rateLimiter<{ Variables: { recoveryUsername: string } }>({
      windowMs: WINDOW_MS,
      max: 5,
      key: (c) => JSON.stringify([requestIp(c), c.get("recoveryUsername")]),
    }),
    async (c) => {
      try {
        if (!configStore.get("passkeyEnabled"))
          return badRequest(c, "Passkey sign-in is currently disabled.")
        const body = c.req.valid("json")
        const [row] = await db
          .select({ account: user, hash: userRecoveryKey.secret_hash })
          .from(user)
          .leftJoin(userRecoveryKey, eq(userRecoveryKey.user_id, user.id))
          .where(eq(sql`lower(${user.username})`, body.username.toLowerCase()))
          .limit(1)
        const recoveryHash = await recoveryKeyMatches(
          body.recoveryKey,
          row?.hash ?? null,
        )
        if (!row || !recoveryHash) return badRequest(c, RECOVERY_KEY_MISMATCH)
        const account = row.account
        if (
          accountSignInState({
            status: account.status,
            disabledAt: account.disabled_at,
            adminSuspendedAt: account.admin_suspended_at,
          }) === "banned"
        ) {
          return authenticatedSignInResponse(c, { kind: "banned" })
        }
        return c.json(
          await beginPasskeyRegistration({
            identifier: account.id,
            origin: c.req.header("origin"),
            payload: { userId: account.id, recoveryHash },
            user: {
              ...account,
              passkeys: await selectUserPasskeys(account.id),
            },
          }),
        )
      } catch (cause) {
        return badRequestFromCause(
          c,
          cause,
          "Could not start passkey registration.",
        )
      }
    },
  )
  .post(
    "/recovery/verify",
    tbValidator("json", PasskeyRegistrationVerifyBody),
    async (c) => {
      try {
        const registration = await verifyRegistrationBody(c.req.valid("json"))
        const { userId, recoveryHash, linkId, username } = registration.payload
        if (!userId || !recoveryHash || linkId || username)
          return badRequest(c, "Invalid passkey registration request.")
        const recoveryKey = await recoverAccount({
          userId,
          recoveryHash,
          registration,
        })
        const result = await completeAuthenticatedSignIn(c, userId)
        if (result.kind !== "session")
          return authenticatedSignInResponse(c, result)
        const body: AccountRecovery = {
          session: await publicSessionData(result.session.data),
          recoveryKey,
        }
        return c.json(body)
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not add passkey.")
      }
    },
  )
