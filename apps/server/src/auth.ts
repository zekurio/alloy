import { passkey as passkeyPlugin } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { admin } from "better-auth/plugins/admin"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { username as usernamePlugin } from "better-auth/plugins/username"
import { eq } from "drizzle-orm"

import { db } from "./db"
import * as authSchema from "@workspace/db/auth-schema"
import { user } from "@workspace/db/auth-schema"
import { env } from "./env"
import { configStore } from "./lib/config-store"
import {
  buildGenericOAuthConfig,
  buildTrustedProviders,
} from "./lib/oauth-config"
import { verifyPasskeySignUpContext } from "./routes/auth-config"
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
      before: async (user: IncomingUser, ctx: { path?: string } | null) => {
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

        if (
          isOAuthCallback(ctx?.path) &&
          !configStore.get("openRegistrations")
        ) {
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

async function createPasskeyRegistrationUser(
  context: string | null | undefined
) {
  let payload: ReturnType<typeof verifyPasskeySignUpContext>
  try {
    payload = verifyPasskeySignUpContext(context)
  } catch (cause) {
    throw new APIError("BAD_REQUEST", {
      message:
        cause instanceof Error
          ? cause.message
          : "Invalid registration request.",
    })
  }
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, payload.email))
    .limit(1)
  if (existing.length > 0) {
    throw new APIError("BAD_REQUEST", {
      message: "An account already exists for that email address.",
    })
  }
  const identity = await populateIdentityFields({
    name: payload.username,
    email: payload.email,
  })
  return {
    email: payload.email,
    ...identity,
  }
}

function buildPasskeyPlugin() {
  return passkeyPlugin({
    rpName: "alloy",
    rpID: new URL(env.BETTER_AUTH_URL).hostname,
    origin: env.TRUSTED_ORIGINS,
    registration: {
      requireSession: false,
      resolveUser: async ({ context }) => {
        const identity = await createPasskeyRegistrationUser(context)
        return {
          id: crypto.randomUUID(),
          name: identity.email,
          displayName: identity.name,
        }
      },
      afterVerification: async ({ context, ctx }) => {
        if (!context) return

        const identity = await createPasskeyRegistrationUser(context)
        const user = await ctx.context.internalAdapter.createUser({
          email: identity.email,
          name: identity.name,
          username: identity.username,
        })
        const session = await ctx.context.internalAdapter.createSession(user.id)
        ctx.context.setNewSession({ session, user })
        return { userId: user.id }
      },
    },
  })
}

function buildAuth() {
  const emailPasswordEnabled = configStore.get("emailPasswordEnabled")
  const passkeyEnabled = configStore.get("passkeyEnabled")
  const plugins = [
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
    ...(passkeyEnabled ? [buildPasskeyPlugin()] : []),
  ]
  return betterAuth({
    appName: "alloy",
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
        trustedProviders: buildTrustedProviders(),
        // Required for the settings-page "link another provider" flow when
        // the second provider returns a different email than the first.
        allowDifferentEmails: true,
      },
    },
    user: {
      additionalFields: {
        banner: {
          type: "string",
          required: false,
        },
      },
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
    plugins,
    databaseHooks: {
      user: buildUserHooks(),
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
  const passkeyChanged = next.passkeyEnabled !== prev.passkeyEnabled
  if (
    !providerChanged &&
    !openRegistrationsChanged &&
    !emailPasswordChanged &&
    !passkeyChanged
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

/** Re-exported so other modules don't need to import the username lib directly. */
export { slugifyUsername }

export type Auth = ReturnType<typeof buildAuth>
export type Session = Auth["$Infer"]["Session"]
