import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"

import { authAccount } from "@workspace/db/auth-schema"

import { db } from "../db"
import { clearOAuthStateCookie, setOAuthStateCookie } from "../auth/cookies"
import { unlinkOAuthAccountPreservingSignIn } from "../auth/identity"
import {
  fallbackOAuthErrorRedirect,
  finishOAuthCallback,
  startOAuthLink,
  startOAuthSignIn,
} from "../auth/oauth"
import { requireSession } from "../auth/session"
import { errorMessage } from "./auth-route-helpers"

const UnlinkAccountBody = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1),
})

const OAuthStartBody = z.object({
  providerId: z.string().min(1),
  callbackURL: z.string().optional().nullable(),
})

async function startOAuthResponse(
  c: Context,
  input: z.infer<typeof OAuthStartBody> & { userId?: string },
  fallback: string
) {
  try {
    const result = input.userId
      ? await startOAuthLink(
          input as z.infer<typeof OAuthStartBody> & {
            userId: string
          }
        )
      : await startOAuthSignIn(input)
    setOAuthStateCookie(c, input.providerId, result.browserNonce)
    return c.json({ url: result.url })
  } catch (cause) {
    return c.json({ error: errorMessage(cause, fallback) }, 400)
  }
}

export const authOAuthRoute = new Hono()
  .get("/accounts", requireSession, async (c) => {
    const rows = await db
      .select({
        id: authAccount.id,
        providerId: authAccount.providerId,
        accountId: authAccount.providerAccountId,
        createdAt: authAccount.createdAt,
      })
      .from(authAccount)
      .where(eq(authAccount.userId, c.var.viewerId))
      .orderBy(authAccount.createdAt)
    return c.json(rows)
  })
  .post("/oauth/sign-in", zValidator("json", OAuthStartBody), async (c) => {
    return startOAuthResponse(
      c,
      c.req.valid("json"),
      "Could not start OAuth sign-in."
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
        "Could not start OAuth link."
      )
    }
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
        return c.json(
          {
            error: "Add another sign-in method before unlinking this account.",
          },
          400
        )
      }
      if (result === "not-found")
        return c.json({ error: "Account not found." }, 404)
      return c.json({ success: true })
    }
  )
