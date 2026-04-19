import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { getAuth } from "../auth"
import { syncOAuthImage, type SyncStatus } from "../lib/oauth-sync"

const requireSession = createMiddleware<{
  Variables: { userId: string }
}>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("userId", session.user.id)
  await next()
})

/**
 * Human-readable explanation for each sync outcome. Shown back to the user
 * in a toast — the failure cases are legitimate user-facing states (no
 * provider configured, SSO not linked yet, etc.), not bugs to hide.
 */
const SYNC_MESSAGES: Record<SyncStatus, string> = {
  ok: "Profile image synced from the identity provider.",
  "no-oauth-provider": "No OAuth provider is configured for this server.",
  "no-linked-account":
    "Your account isn't linked to the OAuth provider yet. Sign in with it once to link.",
  "no-access-token":
    "No stored access token for your linked account — sign in with the OAuth provider again to refresh it.",
  "no-userinfo-url":
    "OAuth provider is misconfigured (missing userinfo endpoint).",
  "no-image-in-response":
    "The OAuth provider didn't return a profile picture for you.",
  "fetch-failed": "Couldn't reach the OAuth provider.",
}

export const profileRoute = new Hono()
  .use("*", requireSession)
  .post("/sync-oauth-image", async (c) => {
    const userId = c.var.userId
    const result = await syncOAuthImage(userId, { overwrite: true })
    const body = {
      status: result.status,
      image: result.image,
      message:
        result.status === "fetch-failed" && result.message
          ? `${SYNC_MESSAGES[result.status]} (${result.message})`
          : SYNC_MESSAGES[result.status],
    }
    if (result.status === "ok") return c.json(body)
    return c.json(body, 400)
  })
