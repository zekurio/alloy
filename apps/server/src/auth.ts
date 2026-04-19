import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { admin } from "better-auth/plugins/admin"
import { genericOAuth } from "better-auth/plugins/generic-oauth"

import { db } from "./db"
import * as authSchema from "./db/auth-schema"
import { env } from "./env"
import { configStore } from "./lib/config-store"
import { buildGenericOAuthConfig } from "./lib/oauth-config"
import { syncOAuthImage } from "./lib/oauth-sync"
import { hasAnyUser, hasOtherAdmin } from "./lib/user-bootstrap"

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
  const provider = configStore.get("oauthProvider")
  const emailPasswordEnabled = configStore.get("emailPasswordEnabled")
  return betterAuth({
    appName: "Alloy",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      // Admin-controlled toggle. When false better-auth refuses both
      // `/sign-in/email` and `/sign-up/email` outright. The user-create
      // hook below still gates the first-run setup case (one-shot signup)
      // independently of this flag.
      enabled: emailPasswordEnabled,
    },
    account: {
      // Lets an OAuth callback for an email that already has a local user
      // attach the new identity onto that user instead of erroring out.
      // This is what makes "admin seeds a user, user logs in via OAuth"
      // work end-to-end. Scoped to the configured provider only — we
      // don't want arbitrary unverified providers claiming local accounts.
      accountLinking: {
        enabled: true,
        trustedProviders: provider ? [provider.providerId] : [],
      },
    },
    user: {
      // Self-service account deletion from the profile page. The client
      // calls `authClient.deleteUser()`; better-auth signs the user out and
      // removes their rows. No email verification step — we rely on the
      // fresh session + a confirm dialog on the client.
      deleteUser: {
        enabled: true,
        // Guard against orphaning the instance: an admin deleting their own
        // account is fine as long as someone else still holds the role. If
        // they're the last one, refuse — they need to promote a replacement
        // first. Non-admin users are unaffected.
        beforeDelete: async (u) => {
          // `role` is contributed by the admin() plugin and isn't in the
          // base user type for this hook's callback signature — assert it.
          if ((u as { role?: string }).role !== "admin") return
          if (await hasOtherAdmin(u.id)) return
          throw new APIError("BAD_REQUEST", {
            message:
              "Cannot delete the last admin account. Promote another user to admin first.",
          })
        },
      },
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
      session: {
        create: {
          after: async (session, ctx) => {
            // Opportunistic avatar sync: when a session is minted from an
            // OAuth callback, top up `user.image` from the provider's
            // userinfo if it's currently empty. Conservative on purpose —
            // we never overwrite an image the user set by hand. The manual
            // "Sync" button on the profile page passes `overwrite: true`
            // for a hard refresh.
            if (!isOAuthCallback(ctx?.path)) return
            try {
              await syncOAuthImage(session.userId, { overwrite: false })
            } catch (err) {
              // Profile sync is best-effort; a bad provider response must
              // never block sign-in.
              console.warn(
                "[auth] post-signin OAuth image sync failed:",
                err instanceof Error ? err.message : err,
              )
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
  // Rebuild when anything baked into the plugin config at init time
  // changes. `openRegistrations` feeds `disableSignUp` on the genericOAuth
  // provider (see buildGenericOAuthConfig) — without this branch the
  // static flag goes stale and better-auth returns `signup_disabled` even
  // after the admin flips the toggle on. Stringify because the store
  // re-parses through Zod on every write, so reference equality misses.
  const providerChanged =
    JSON.stringify(next.oauthProvider) !== JSON.stringify(prev.oauthProvider)
  const openRegistrationsChanged =
    next.openRegistrations !== prev.openRegistrations
  const emailPasswordChanged =
    next.emailPasswordEnabled !== prev.emailPasswordEnabled
  if (!providerChanged && !openRegistrationsChanged && !emailPasswordChanged) {
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
