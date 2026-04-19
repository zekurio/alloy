import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { getAuth } from "../auth"
import {
  OAuthProviderSubmissionSchema,
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
  emailPasswordEnabled: z.boolean().optional(),
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
    // Refuse to disable the only remaining sign-in surface — without an
    // OAuth provider configured, turning email/password off would lock
    // every existing user (admins included) out of the app.
    if (
      body.emailPasswordEnabled === false &&
      configStore.get("oauthProvider") === null
    ) {
      return c.json(
        {
          error:
            "Configure an OAuth provider before disabling email/password — otherwise no one can sign in.",
        },
        400,
      )
    }
    const patch: Partial<{
      openRegistrations: boolean
      emailPasswordEnabled: boolean
    }> = {}
    if (body.openRegistrations !== undefined) {
      patch.openRegistrations = body.openRegistrations
    }
    if (body.emailPasswordEnabled !== undefined) {
      patch.emailPasswordEnabled = body.emailPasswordEnabled
    }
    if (Object.keys(patch).length > 0) configStore.patch(patch)
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
  // PUT replaces the provider wholesale; DELETE clears it. An empty
  // `clientSecret` in the submission means "keep the existing secret" —
  // lets admins tweak settings without re-entering a rotated secret.
  .put(
    "/oauth-provider",
    zValidator("json", OAuthProviderSubmissionSchema),
    (c) => {
      const submission = c.req.valid("json")
      const existing = configStore.get("oauthProvider")
      const clientSecret =
        submission.clientSecret.length > 0
          ? submission.clientSecret
          : (existing?.clientSecret ?? "")
      if (clientSecret.length === 0) {
        return c.json(
          { error: "clientSecret is required when no provider is configured." },
          400,
        )
      }
      configStore.set("oauthProvider", { ...submission, clientSecret })
      return c.json(redactOAuthProvider(configStore.getAll()))
    },
  )
  .delete("/oauth-provider", (c) => {
    // Same lockout guard as the runtime-config patch: don't let the admin
    // remove the only remaining sign-in surface.
    if (!configStore.get("emailPasswordEnabled")) {
      return c.json(
        {
          error:
            "Re-enable email/password login before removing the OAuth provider — otherwise no one can sign in.",
        },
        400,
      )
    }
    configStore.set("oauthProvider", null)
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
