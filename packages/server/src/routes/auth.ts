import {
  AUTH_ERROR_CODES,
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { consumeAccountReactivation } from "@alloy/server/auth/account-reactivation"
import { completeAuthenticatedSignIn } from "@alloy/server/auth/account-sign-in"
import {
  clearAccountReactivationCookie,
  clearSessionCookies,
  readAccountReactivationCookie,
} from "@alloy/server/auth/cookies"
import {
  reactivateSelfDisabledIdentity,
  updateUserIdentity,
} from "@alloy/server/auth/identity"
import {
  publicAuthUserRow,
  publicSessionData,
} from "@alloy/server/auth/security-responses"
import {
  deleteCurrentSession,
  getSession,
  refreshSession,
  requireAnySession,
  requireSession,
} from "@alloy/server/auth/session"
import {
  badRequest,
  badRequestFromCause,
  success,
  unauthorized,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { deleteUserAccount } from "@alloy/server/users/account-deletion"
import { accountDeletionState } from "@alloy/server/users/account-deletion-state"
import { Hono, type Context } from "hono"

import { authDesktopRoute } from "./auth-desktop"
import { authOAuthRoute } from "./auth-oauth-routes"
import { authPasskeyRoutes } from "./auth-passkey-routes"
import {
  authenticatedSignInResponse,
  authError,
  csrf,
} from "./auth-route-helpers"
import { tbValidator } from "./validation"

const UpdateUserBody = t.object({
  username: t
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .optional(),
  // Empty string is meaningful here: it clears the display name.
  displayName: t.string().max(DISPLAY_NAME_MAX_LENGTH).optional(),
  clipAnnouncementsEnabled: t.boolean().optional(),
})

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const STRICT_AUTH_RATE_LIMIT_PATHS = new Set([
  "/passkey/sign-up/options",
  "/passkey/sign-in/options",
  "/oauth/sign-in",
  "/oauth/link",
])
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const ACCOUNT_BANNED_CODE = AUTH_ERROR_CODES.accountBanned

function authSubpath(c: Context): string {
  const path = c.req.path
  return path.startsWith("/api/auth") ? path.slice("/api/auth".length) : path
}

const strictAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10,
  key: requestIp,
})

const standardAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 30,
  key: (c) => {
    if (!MUTATING_METHODS.has(c.req.method)) return null
    if (STRICT_AUTH_RATE_LIMIT_PATHS.has(authSubpath(c))) return null
    return requestIp(c)
  },
})

export const authRoute = new Hono()
  .use("*", csrf)
  .use("*", standardAuthRateLimit)
  .use("/passkey/sign-up/options", strictAuthRateLimit)
  .use("/passkey/sign-in/options", strictAuthRateLimit)
  .use("/oauth/sign-in", strictAuthRateLimit)
  .use("/oauth/link", strictAuthRateLimit)
  .get("/session", async (c) => {
    const session = await getSession(c)
    return c.json(session ? publicSessionData(session) : null)
  })
  .post("/refresh", async (c) => {
    const refreshed = await refreshSession(c)
    if (!refreshed) return unauthorized(c)
    return c.json(publicSessionData(refreshed.data))
  })
  .post("/sign-out", async (c) => {
    await deleteCurrentSession(c)
    clearSessionCookies(c)
    return success(c)
  })
  .post("/reactivate", async (c) => {
    const token = readAccountReactivationCookie(c)
    clearAccountReactivationCookie(c)
    if (!token) return badRequest(c, "Account reactivation expired.")

    const userId = await consumeAccountReactivation(token)
    if (!userId) return badRequest(c, "Account reactivation expired.")

    const reactivated = await accountDeletionState.withInactive(userId, () =>
      reactivateSelfDisabledIdentity(userId),
    )
    if (!reactivated.ok) {
      return badRequest(c, "Account deletion is in progress.")
    }
    if (reactivated.value === "not-found") {
      return badRequest(c, "Account reactivation expired.")
    }
    if (reactivated.value === "suspended") {
      return authError(
        c,
        403,
        ACCOUNT_BANNED_CODE,
        "This account has been banned by an administrator.",
      )
    }

    return authenticatedSignInResponse(
      c,
      await completeAuthenticatedSignIn(c, userId),
    )
  })
  .route("/", authPasskeyRoutes)
  .patch(
    "/user",
    requireSession,
    tbValidator("json", UpdateUserBody),
    async (c) => {
      try {
        const updated = await updateUserIdentity(
          c.var.viewerId,
          c.req.valid("json"),
        )
        return c.json({ user: publicAuthUserRow(updated) })
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not update user.")
      }
    },
  )
  .delete("/user", requireAnySession, async (c) => {
    try {
      await deleteUserAccount(c.var.viewerId, "self")
      clearSessionCookies(c)
      return success(c)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Could not delete user.")
    }
  })
  .route("/desktop", authDesktopRoute)
  .route("/", authOAuthRoute)
