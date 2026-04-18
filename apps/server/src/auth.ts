import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins/admin"
import { genericOAuth } from "better-auth/plugins/generic-oauth"

import { db } from "./db"
import * as authSchema from "./db/auth-schema"
import { env } from "./env"
import { configStore } from "./lib/config-store"
import { buildGenericOAuthConfig } from "./lib/oauth-config"
import { hasAnyUser } from "./lib/user-bootstrap"

// better-auth reads plugin config at init time, so when the OAuth provider
// changes at runtime we rebuild the instance and swap it in. Callers must
// resolve through `getAuth()` to always see the latest build.

const OAUTH_CALLBACK_PREFIXES = ["/callback/", "/oauth2/callback/"] as const
const EMAIL_SIGNUP_PATH = "/sign-up/email"

function isOAuthCallback(path: string | undefined): boolean {
  if (!path) return false
  return OAUTH_CALLBACK_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function isEmailSignUp(path: string | undefined): boolean {
  return path === EMAIL_SIGNUP_PATH
}

function buildAuth() {
  return betterAuth({
    appName: "Alloy",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      // Gated in the user-create hook below — email sign-up is only open
      // to the first visitor; after that it's a login-only surface.
      enabled: true,
    },
    plugins: [
      admin(),
      // Mounted unconditionally so admins can add a provider later without
      // a restart. `buildGenericOAuthConfig()` returns [] when none.
      genericOAuth({ config: buildGenericOAuthConfig() }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (isEmailSignUp(ctx?.path)) {
              if (configStore.get("setupComplete")) return false
              // Race defence: an admin may have seeded a user out-of-band.
              // Reconcile the flag so future attempts short-circuit on the
              // config-store read instead of hitting the DB.
              if (await hasAnyUser()) {
                configStore.set("setupComplete", true)
                return false
              }
              return { data: { ...user, role: "admin" } }
            }

            // The live gate. `disableSignUp` on the provider is a static
            // first-line filter set when the auth instance was built;
            // this reads the toggle fresh on every callback.
            if (
              isOAuthCallback(ctx?.path) &&
              !configStore.get("openRegistrations")
            ) {
              return false
            }

            return { data: user }
          },
          after: async (_user, ctx) => {
            // Flip the flag in `after` so a failed create doesn't lock the
            // setup page forever.
            if (
              isEmailSignUp(ctx?.path) &&
              !configStore.get("setupComplete")
            ) {
              configStore.set("setupComplete", true)
            }
          },
        },
      },
    },
    trustedOrigins: env.TRUSTED_ORIGINS,
  })
}

let currentAuth = buildAuth()

configStore.subscribe((next, prev) => {
  // Only the OAuth provider affects the init shape; everything else is
  // read fresh per-request. Stringify because the store re-parses through
  // Zod on every write, so reference equality would always miss.
  if (
    JSON.stringify(next.oauthProvider) === JSON.stringify(prev.oauthProvider)
  ) {
    return
  }
  currentAuth = buildAuth()
})

/**
 * Always call through this — the underlying reference may change when the
 * admin updates the OAuth provider.
 */
export function getAuth(): ReturnType<typeof buildAuth> {
  return currentAuth
}

export type Auth = ReturnType<typeof buildAuth>
export type Session = Auth["$Infer"]["Session"]
