import { OAUTH_SIGN_IN_ACCOUNTS } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { createLogger } from "@alloy/logging"
import {
  clearOAuthPendingLinkCookie,
  readOAuthPendingLinkCookie,
  setOAuthStateCookie,
} from "@alloy/server/auth/cookies"
import {
  setupRequired,
  unlinkOAuthAccountPreservingSignIn,
} from "@alloy/server/auth/identity"
import {
  fallbackOAuthErrorRedirect,
  finishOAuthCallback,
  startOAuthLink,
  startOAuthSignIn,
} from "@alloy/server/auth/oauth"
import { listLinkedAccounts } from "@alloy/server/auth/oauth-accounts"
import {
  oauthErrorLogDetail,
  oauthErrorMessage,
} from "@alloy/server/auth/oauth-client"
import {
  discardPendingOAuthLink,
  linkPendingOAuthAccount,
  readPendingOAuthLink,
  signUpPendingOAuthAccount,
} from "@alloy/server/auth/oauth-pending-link"
import { publicLinkedAccountRow } from "@alloy/server/auth/security-responses"
import { getSession, requireSession } from "@alloy/server/auth/session"
import {
  hasSetupAccess,
  SETUP_ACCESS_REQUIRED,
} from "@alloy/server/auth/setup-token"
import {
  badRequest,
  badRequestFromCause,
  forbidden,
  notFound,
  success,
  urlResponse,
} from "@alloy/server/runtime/http-response"
import { type Context, Hono } from "hono"

import { authenticatedSignInResponse } from "./auth-route-helpers"
import {
  optionalNullableTrimmedString,
  requiredTrimmedString,
  tbValidator,
} from "./validation"

const logger = createLogger("oauth")

const UnlinkAccountBody = t.object({
  providerId: requiredTrimmedString(),
  accountId: requiredTrimmedString(),
})

const OAuthStartBody = t.object({
  providerId: requiredTrimmedString(),
  callbackURL: optionalNullableTrimmedString(),
})

const OAuthSignInBody = OAuthStartBody.extend({
  account: t.enum(OAUTH_SIGN_IN_ACCOUNTS).optional(),
  /** Create the first admin; needs setup access. */
  setup: t.boolean().optional(),
})

async function startOAuthResponse(
  c: Context,
  input: t.infer<typeof OAuthSignInBody> & { userId?: string },
  fallback: string,
) {
  try {
    if (input.setup) {
      if (!(await setupRequired())) {
        return badRequest(c, "Setup is already complete.")
      }
      if (!hasSetupAccess(c)) return forbidden(c, SETUP_ACCESS_REQUIRED)
    }
    const result = input.userId
      ? await startOAuthLink({ ...input, userId: input.userId })
      : await startOAuthSignIn({ ...input, setupFirstAdmin: input.setup })
    setOAuthStateCookie(c, input.providerId, result.browserNonce)
    return urlResponse(c, result.url)
  } catch (cause) {
    return badRequestFromCause(c, cause, fallback)
  }
}

/**
 * A failed pending link or sign-up. Account writes carry the provider's
 * tokens, so a database error is logged and answered without its message.
 */
function pendingOAuthFailure(c: Context, action: string, cause: unknown) {
  logger.warn(`pending ${action} failed:`, oauthErrorLogDetail(cause))
  return badRequest(c, oauthErrorMessage(cause))
}

export const authOAuthRoute = new Hono()
  .get("/accounts", requireSession, async (c) => {
    const rows = await listLinkedAccounts(c.var.viewerId)
    return c.json(rows.map(publicLinkedAccountRow))
  })
  .post("/oauth/sign-in", tbValidator("json", OAuthSignInBody), async (c) => {
    return startOAuthResponse(
      c,
      c.req.valid("json"),
      "Could not start OAuth sign-in.",
    )
  })
  .post(
    "/oauth/link",
    requireSession,
    tbValidator("json", OAuthStartBody),
    async (c) => {
      return startOAuthResponse(
        c,
        { ...c.req.valid("json"), userId: c.var.viewerId },
        "Could not start OAuth link.",
      )
    },
  )
  .get("/oauth/pending", async (c) => {
    const token = readOAuthPendingLinkCookie(c)
    const pending = await readPendingOAuthLink(token)
    if (token && !pending) clearOAuthPendingLinkCookie(c)
    return c.json(pending)
  })
  .delete("/oauth/pending", async (c) => {
    const token = readOAuthPendingLinkCookie(c)
    clearOAuthPendingLinkCookie(c)
    await discardPendingOAuthLink(token)
    return success(c)
  })
  .post("/oauth/pending/link", requireSession, async (c) => {
    const token = readOAuthPendingLinkCookie(c)
    clearOAuthPendingLinkCookie(c)
    try {
      return urlResponse(
        c,
        await linkPendingOAuthAccount(token, c.var.viewerId),
      )
    } catch (cause) {
      return pendingOAuthFailure(c, "link", cause)
    }
  })
  .post("/oauth/pending/sign-up", async (c) => {
    // A signed-in browser links the pending sign-in instead. A stale tab must
    // not swap it into a new account, so refuse before using the record up.
    if (await getSession(c)) {
      return badRequest(c, "Sign out before creating a new account.")
    }
    const token = readOAuthPendingLinkCookie(c)
    clearOAuthPendingLinkCookie(c)
    try {
      const { signIn, redirectTo } = await signUpPendingOAuthAccount(c, token)
      if (signIn.kind !== "session") {
        return authenticatedSignInResponse(c, signIn)
      }
      return urlResponse(c, redirectTo)
    } catch (cause) {
      return pendingOAuthFailure(c, "sign-up", cause)
    }
  })
  .get("/oauth2/callback/:providerId", async (c) => {
    try {
      const result = await finishOAuthCallback(c, c.req.param("providerId"))
      return c.redirect(result.redirectTo)
    } catch (cause) {
      return c.redirect(fallbackOAuthErrorRedirect(cause))
    }
  })
  .post(
    "/accounts/unlink",
    requireSession,
    tbValidator("json", UnlinkAccountBody),
    async (c) => {
      const body = c.req.valid("json")
      const result = await unlinkOAuthAccountPreservingSignIn({
        userId: c.var.viewerId,
        providerId: body.providerId,
        providerAccountId: body.accountId,
      })
      if (result === "last-sign-in-method") {
        return badRequest(
          c,
          "Add another sign-in method before unlinking this account.",
        )
      }
      if (result === "not-found") return notFound(c)
      return success(c)
    },
  )
