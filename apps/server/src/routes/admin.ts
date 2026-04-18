import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { getAuth } from "../auth"
import {
  OAuthProviderSchema,
  configStore,
  type RuntimeConfig,
} from "../lib/config-store"

const requireAdmin = createMiddleware<{
  Variables: { adminUserId: string }
}>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  const role = (session.user as { role?: string }).role
  if (role !== "admin") {
    return c.json({ error: "Forbidden" }, 403)
  }
  c.set("adminUserId", session.user.id)
  await next()
})

const RuntimeConfigPatch = z.object({
  openRegistrations: z.boolean().optional(),
})

/**
 * Strip the client secret before handing the config to the admin UI.
 * Admins re-enter it on every save — same pattern as GitHub Actions secrets.
 */
function redactOAuthProvider(
  config: Readonly<RuntimeConfig>,
): Readonly<RuntimeConfig> {
  if (!config.oauthProvider) return config
  return {
    ...config,
    oauthProvider: { ...config.oauthProvider, clientSecret: "" },
  }
}

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .get("/runtime-config", (c) => {
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
  .patch("/runtime-config", zValidator("json", RuntimeConfigPatch), (c) => {
    const body = c.req.valid("json")
    if (body.openRegistrations !== undefined) {
      configStore.set("openRegistrations", body.openRegistrations)
    }
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
  // PUT replaces the provider wholesale; DELETE clears it.
  .put(
    "/oauth-provider",
    zValidator("json", OAuthProviderSchema),
    (c) => {
      configStore.set("oauthProvider", c.req.valid("json"))
      return c.json(redactOAuthProvider(configStore.getAll()))
    },
  )
  .delete("/oauth-provider", (c) => {
    configStore.set("oauthProvider", null)
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
