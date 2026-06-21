import { authAccount } from "@alloy/db/auth-schema"
import {
  clearOAuthStateCookie,
  setOAuthStateCookie,
} from "@alloy/server/auth/cookies"
import { unlinkOAuthAccountPreservingSignIn } from "@alloy/server/auth/identity"
import {
  fallbackOAuthErrorRedirect,
  finishOAuthCallback,
  startOAuthLink,
  startOAuthSignIn,
} from "@alloy/server/auth/oauth"
import { publicLinkedAccountRow } from "@alloy/server/auth/security-responses"
import { requireSession } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  badRequestFromCause,
  notFound,
  success,
  urlResponse,
} from "@alloy/server/runtime/http-response"
import { eq } from "drizzle-orm"
import { type Context, Hono } from "hono"
import { z } from "zod"

import {
  optionalNullableTrimmedString,
  requiredTrimmedString,
  zValidator,
} from "./validation"

const UnlinkAccountBody = z.object({
  providerId: requiredTrimmedString(),
  accountId: requiredTrimmedString(),
})

const OAuthStartBody = z.object({
  providerId: requiredTrimmedString(),
  callbackURL: optionalNullableTrimmedString(),
})

async function startOAuthResponse(
  c: Context,
  input: z.infer<typeof OAuthStartBody> & { userId?: string },
  fallback: string,
) {
  try {
    const result = input.userId
      ? await startOAuthLink(
          input as z.infer<typeof OAuthStartBody> & {
            userId: string
          },
        )
      : await startOAuthSignIn(input)
    setOAuthStateCookie(c, input.providerId, result.browserNonce)
    return urlResponse(c, result.url)
  } catch (cause) {
    return badRequestFromCause(c, cause, fallback)
  }
}

export const authOAuthRoute = new Hono()
  .get("/accounts", requireSession, async (c) => {
    const rows = await db
      .select({
        id: authAccount.id,
        providerId: authAccount.provider_id,
        accountId: authAccount.provider_account_id,
        email: authAccount.email,
        createdAt: authAccount.created_at,
      })
      .from(authAccount)
      .where(eq(authAccount.user_id, c.var.viewerId))
      .orderBy(authAccount.created_at)
    return c.json(rows.map(publicLinkedAccountRow))
  })
  .post("/oauth/sign-in", zValidator("json", OAuthStartBody), async (c) => {
    return startOAuthResponse(
      c,
      c.req.valid("json"),
      "Could not start OAuth sign-in.",
    )
  })
  .post(
    "/oauth/link",
    requireSession,
    zValidator("json", OAuthStartBody),
    async (c) => {
      return startOAuthResponse(
        c,
        { ...c.req.valid("json"), userId: c.var.viewerId },
        "Could not start OAuth link.",
      )
    },
  )
  .get("/oauth2/callback/:providerId", async (c) => {
    const providerId = c.req.param("providerId")
    try {
      const result = await finishOAuthCallback(c, providerId)
      return c.redirect(result.redirectTo)
    } catch (cause) {
      clearOAuthStateCookie(c, providerId)
      return c.redirect(fallbackOAuthErrorRedirect(cause))
    }
  })
  .post(
    "/accounts/unlink",
    requireSession,
    zValidator("json", UnlinkAccountBody),
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
