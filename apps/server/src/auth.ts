import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { admin } from "better-auth/plugins/admin"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { username as usernamePlugin } from "better-auth/plugins/username"

import { db } from "./db"
import * as authSchema from "@workspace/db/auth-schema"
import { env } from "./env"
import { configStore } from "./lib/config-store"
import { buildGenericOAuthConfig } from "./lib/oauth-config"
import { syncOAuthImage } from "./lib/oauth-sync"
import { hasAnyUser, hasOtherAdmin } from "./lib/user-bootstrap"
import {
  generateUniqueUsername,
  slugifyUsername,
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
} from "./lib/username"

const OAUTH_CALLBACK_PREFIXES = ["/callback/", "/oauth2/callback/"] as const
const EMAIL_SIGNUP_PATH = "/sign-up/email"

function isOAuthCallback(path: string | undefined): boolean {
  if (!path) return false
  return OAUTH_CALLBACK_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function isEmailSignUp(path: string | undefined): boolean {
  return path === EMAIL_SIGNUP_PATH
}

type IncomingUser = {
  name: string
  email: string
} & Record<string, unknown>

async function populateIdentityFields(
  user: IncomingUser
): Promise<{ name: string; username: string }> {
  const slug = await generateUniqueUsername({
    name: user.name,
    email: user.email,
  })
  return {
    name: (user.name ?? "").trim(),
    username: slug,
  }
}

function buildUserHooks() {
  return {
    create: {
      before: async (
        user: IncomingUser,
        ctx: { path?: string } | null
      ) => {
        if (isEmailSignUp(ctx?.path)) {
          if (!configStore.get("setupComplete")) {
            if (await hasAnyUser()) {
              configStore.set("setupComplete", true)
              return false
            }
            const identity = await populateIdentityFields(user)
            return { data: { ...user, ...identity, role: "admin" } }
          }
          if (
            !configStore.get("openRegistrations") ||
            !configStore.get("emailPasswordEnabled")
          ) {
            return false
          }
          const identity = await populateIdentityFields(user)
          return { data: { ...user, ...identity } }
        }

        if (isOAuthCallback(ctx?.path) && !configStore.get("openRegistrations")) {
          return false
        }

        const identity = await populateIdentityFields(user)
        return { data: { ...user, ...identity } }
      },
      after: async (_user: unknown, ctx: { path?: string } | null) => {
        if (isEmailSignUp(ctx?.path) && !configStore.get("setupComplete")) {
          configStore.set("setupComplete", true)
        }
      },
    },
  }
}

function buildSessionHooks() {
  return {
    create: {
      after: async (
        session: { userId: string } & Record<string, unknown>,
        ctx: { path?: string } | null
      ) => {
        if (!isOAuthCallback(ctx?.path)) return
        try {
          await syncOAuthImage(session.userId, { overwrite: false })
        } catch (err) {
          console.warn(
            "[auth] post-signin OAuth image sync failed:",
            err instanceof Error ? err.message : err
          )
        }
      },
    },
  }
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
    advanced: {
      database: { generateId: false },
    },
    emailAndPassword: {
      enabled: emailPasswordEnabled,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: provider ? [provider.providerId] : [],
      },
    },
    user: {
      deleteUser: {
        enabled: true,
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
      // Accepts the same character set our slugifier produces so handles
      // minted at signup round-trip cleanly through user-driven updates.
      usernamePlugin({
        minUsernameLength: USERNAME_MIN_LEN,
        maxUsernameLength: USERNAME_MAX_LEN,
        usernameValidator: (value) => /^[a-z0-9_-]+$/.test(value),
      }),
      // Mounted unconditionally so admins can add a provider later without
      // a restart. `buildGenericOAuthConfig()` returns [] when none.
      genericOAuth({ config: buildGenericOAuthConfig() }),
    ],
    databaseHooks: {
      user: buildUserHooks(),
      session: buildSessionHooks(),
    },
    trustedOrigins: env.TRUSTED_ORIGINS,
  })
}

let currentAuth = buildAuth()

configStore.subscribe((next, prev) => {
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

/** Re-exported so other modules don't need to import the username lib directly. */
export { slugifyUsername }

export type Auth = ReturnType<typeof buildAuth>
export type Session = Auth["$Infer"]["Session"]
