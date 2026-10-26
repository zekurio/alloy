import { OAUTH_SIGN_IN_ACCOUNTS } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { setOAuthStateCookie } from "@alloy/server/auth/cookies"
import { unlinkOAuthAccountPreservingSignIn } from "@alloy/server/auth/identity"
import {
  fallbackOAuthErrorRedirect,
  finishOAuthCallback,
  startOAuthLink,
  startOAuthSignIn,
} from "@alloy/server/auth/oauth"
import { listLinkedAccounts } from "@alloy/server/auth/oauth-accounts"
import { publicLinkedAccountRow } from "@alloy/server/auth/security-responses"
import { requireSession } from "@alloy/server/auth/session"
import {
  badRequest,
  badRequestFromCause,
  notFound,
  success,
  urlResponse,
} from "@alloy/server/runtime/http-response"
import { type Context, Hono } from "hono"

import {
  optionalNullableTrimmedString,
  requiredTrimmedString,
  tbValidator,
} from "./validation"

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
})

async function startOAuthResponse(
  c: Context,
  input: t.infer<typeof OAuthSignInBody> & { userId?: string },
  fallback: string,
) {
  try {
    const result = input.userId
      ? await startOAuthLink({ ...input, userId: input.userId })
      : await startOAuthSignIn(input)
    setOAuthStateCookie(c, input.providerId, result.browserNonce)
    return urlResponse(c, result.url)
  } catch (cause) {
    return badRequestFromCause(c, cause, fallback)
  }
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
