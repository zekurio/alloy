import {
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { userPasskey } from "@alloy/db/auth-schema"
import {
  clearSessionCookies,
  setSessionCookies,
} from "@alloy/server/auth/cookies"
import {
  deleteUserPasskeyPreservingSignIn,
  setupRequired,
  updateUserIdentity,
  validateUsername,
} from "@alloy/server/auth/identity"
import {
  publicAuthUserRow,
  publicPasskeyRow,
  publicSessionData,
} from "@alloy/server/auth/security-responses"
import {
  createSession,
  deleteCurrentSession,
  getSession,
  refreshSession,
  requireAnySession,
  requireSession,
} from "@alloy/server/auth/session"
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  passkeyPublicKey,
  serializeTransports,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "@alloy/server/auth/webauthn"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  badRequestFromCause,
  internalServerError,
  notFound,
  success,
  unauthorized,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { deleteUserAccount } from "@alloy/server/users/account-deletion"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"

import { authDesktopRoute } from "./auth-desktop"
import { authOAuthRoute } from "./auth-oauth-routes"
import { completePasskeySignUp } from "./auth-passkey-signup"
import { canOpenPasskeyRegistration, csrf } from "./auth-route-helpers"
import {
  optionalNullableBlankToNullTrimmedString,
  requiredTrimmedString,
  tbValidator,
} from "./validation"

const SignUpOptionsBody = t.object({
  username: requiredTrimmedString(),
})

const PublicKeyCredentialFields = {
  id: t.string(),
  rawId: t.string(),
  authenticatorAttachment: t.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: t.record(t.string(), t.unknown()),
  type: t.enum(["public-key"]),
}
const PasskeyRegistrationVerifyBody = t.object({
  challengeId: t.string().uuid(),
  response: t.object({
    ...PublicKeyCredentialFields,
    response: t.object({
      clientDataJSON: t.string(),
      attestationObject: t.string(),
      authenticatorData: t.string().optional(),
      transports: t
        .array(
          t.enum([
            "ble",
            "cable",
            "hybrid",
            "internal",
            "nfc",
            "smart-card",
            "usb",
          ]),
        )
        .optional(),
      publicKeyAlgorithm: t.number().int().optional(),
      publicKey: t.string().optional(),
    }),
  }),
})
const PasskeyAuthenticationVerifyBody = t.object({
  challengeId: t.string().uuid(),
  response: t.object({
    ...PublicKeyCredentialFields,
    response: t.object({
      clientDataJSON: t.string(),
      authenticatorData: t.string(),
      signature: t.string(),
      userHandle: t.string().optional(),
    }),
  }),
})

const PasskeyNameBody = t.object({
  name: optionalNullableBlankToNullTrimmedString(64),
})

const PasskeyNamedRegistrationVerifyBody = PasskeyRegistrationVerifyBody.extend(
  {
    name: optionalNullableBlankToNullTrimmedString(64),
  },
)

const UpdateUserBody = t.object({
  username: t
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .optional(),
  // Empty string is meaningful here: it clears the display name.
  displayName: t.string().max(DISPLAY_NAME_MAX_LENGTH).optional(),
  clipAnnouncementsEnabled: t.boolean().optional(),
})

const UuidParam = t.object({
  id: t.string().uuid(),
})

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const STRICT_AUTH_RATE_LIMIT_PATHS = new Set([
  "/passkey/sign-up/options",
  "/passkey/sign-in/options",
  "/oauth/sign-in",
  "/oauth/link",
])
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function authSubpath(c: Context): string {
  const path = c.req.path
  return path.startsWith("/api/auth") ? path.slice("/api/auth".length) : path
}

const strictAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10,
  key: requestIp,
})

const standardAuthRateLimit = rateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 30,
  key: (c) => {
    if (!MUTATING_METHODS.has(c.req.method)) return null
    if (STRICT_AUTH_RATE_LIMIT_PATHS.has(authSubpath(c))) return null
    return requestIp(c)
  },
})

export const authRoute = new Hono()
  .use("*", csrf)
  .use("*", standardAuthRateLimit)
  .use("/passkey/sign-up/options", strictAuthRateLimit)
  .use("/passkey/sign-in/options", strictAuthRateLimit)
  .use("/oauth/sign-in", strictAuthRateLimit)
  .use("/oauth/link", strictAuthRateLimit)
  .get("/session", async (c) => {
    const session = await getSession(c)
    return c.json(session ? publicSessionData(session) : null)
  })
  .post("/refresh", async (c) => {
    const refreshed = await refreshSession(c)
    if (!refreshed) return unauthorized(c)
    return c.json(publicSessionData(refreshed.data))
  })
  .post("/sign-out", async (c) => {
    await deleteCurrentSession(c)
    clearSessionCookies(c)
    return success(c)
  })
  .post(
    "/passkey/sign-up/options",
    tbValidator("json", SignUpOptionsBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const setupFirstAdmin = await setupRequired()
        if (!setupFirstAdmin && !(await canOpenPasskeyRegistration())) {
          return badRequest(c, "Passkey sign-up is currently disabled.")
        }

        const username = validateUsername(body.username)
        const registration = await beginPasskeyRegistration({
          identifier: username,
          origin: c.req.header("origin"),
          payload: { username, setupFirstAdmin },
          user: { id: crypto.randomUUID(), username },
        })
        return c.json(registration)
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not start sign-up.")
      }
    },
  )
  .post(
    "/passkey/sign-up/verify",
    tbValidator("json", PasskeyRegistrationVerifyBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        // SAFETY: The request schema checks the WebAuthn registration wire
        // fields. SimpleWebAuthn validates their encoded contents.
        const response = body.response as RegistrationResponseJSON
        const { payload, verification } = await verifyPasskeyRegistration({
          challengeId: body.challengeId,
          response,
        })
        if (!payload.username) {
          return badRequest(c, "Invalid registration request.")
        }
        const userRow = await completePasskeySignUp({
          payload,
          registrationInfo: verification.registrationInfo,
          response,
        })

        const { tokens, data } = await createSession(c, userRow.id)
        setSessionCookies(c, tokens)
        return c.json(publicSessionData(data))
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not verify passkey.")
      }
    },
  )
  .post("/passkey/sign-in/options", async (c) => {
    try {
      return c.json(
        await beginPasskeyAuthentication({ origin: c.req.header("origin") }),
      )
    } catch (cause) {
      return badRequestFromCause(c, cause, "Could not start sign-in.")
    }
  })
  .post(
    "/passkey/sign-in/verify",
    tbValidator("json", PasskeyAuthenticationVerifyBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        // SAFETY: The request schema checks the WebAuthn authentication wire
        // fields. SimpleWebAuthn validates their encoded contents.
        const { credential, verification } = await verifyPasskeyAuthentication({
          challengeId: body.challengeId,
          response: body.response as AuthenticationResponseJSON,
        })
        const now = new Date()
        await db
          .update(userPasskey)
          .set({
            counter: verification.authenticationInfo.newCounter,
            last_used_at: now,
            updated_at: now,
          })
          .where(eq(userPasskey.id, credential.id))
        const { tokens, data } = await createSession(c, credential.user_id)
        setSessionCookies(c, tokens)
        return c.json(publicSessionData(data))
      } catch (cause) {
        return badRequestFromCause(c, cause, "Passkey sign-in failed.")
      }
    },
  )
  .get("/passkeys", requireSession, async (c) => {
    const rows = await db
      .select({
        id: userPasskey.id,
        name: userPasskey.name,
        createdAt: userPasskey.created_at,
        deviceType: userPasskey.device_type,
      })
      .from(userPasskey)
      .where(eq(userPasskey.user_id, c.var.viewerId))
      .orderBy(userPasskey.created_at)
    return c.json(rows.map(publicPasskeyRow))
  })
  .post("/passkeys/options", requireSession, async (c) => {
    try {
      const passkeys = await db
        .select()
        .from(userPasskey)
        .where(eq(userPasskey.user_id, c.var.viewerId))
      return c.json(
        await beginPasskeyRegistration({
          identifier: c.var.viewerId,
          origin: c.req.header("origin"),
          payload: { userId: c.var.viewerId },
          user: { ...c.var.session.user, passkeys },
        }),
      )
    } catch (cause) {
      return badRequestFromCause(
        c,
        cause,
        "Could not start passkey registration.",
      )
    }
  })
  .post(
    "/passkeys/verify",
    requireSession,
    tbValidator("json", PasskeyNamedRegistrationVerifyBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        // SAFETY: The request schema checks the WebAuthn registration wire
        // fields. SimpleWebAuthn validates their encoded contents.
        const response = body.response as RegistrationResponseJSON
        const { payload, verification } = await verifyPasskeyRegistration({
          challengeId: body.challengeId,
          response,
        })
        if (payload.userId !== c.var.viewerId) {
          return badRequest(c, "Invalid passkey registration request.")
        }
        const info = verification.registrationInfo
        const [created] = await db
          .insert(userPasskey)
          .values({
            user_id: c.var.viewerId,
            credential_id: info.credential.id,
            public_key: passkeyPublicKey(info.credential.publicKey),
            counter: info.credential.counter,
            device_type: info.credentialDeviceType,
            backed_up: info.credentialBackedUp,
            transports: serializeTransports(response.response.transports),
            aaguid: info.aaguid,
            name: body.name ?? null,
          })
          .returning()
        if (!created) return internalServerError(c, "Passkey insert failed")
        return c.json(publicPasskeyRow(created))
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not add passkey.")
      }
    },
  )
  .patch(
    "/passkeys/:id",
    requireSession,
    tbValidator("param", UuidParam),
    tbValidator("json", PasskeyNameBody),
    async (c) => {
      const { id } = c.req.valid("param")
      const { name } = c.req.valid("json")
      const [updated] = await db
        .update(userPasskey)
        .set({ name: name ?? null, updated_at: new Date() })
        .where(
          and(eq(userPasskey.id, id), eq(userPasskey.user_id, c.var.viewerId)),
        )
        .returning()
      if (!updated) return notFound(c, "Passkey not found.")
      return c.json(publicPasskeyRow(updated))
    },
  )
  .delete(
    "/passkeys/:id",
    requireSession,
    tbValidator("param", UuidParam),
    async (c) => {
      const { id } = c.req.valid("param")
      const result = await deleteUserPasskeyPreservingSignIn({
        userId: c.var.viewerId,
        passkeyId: id,
      })
      if (result === "last-sign-in-method") {
        return badRequest(
          c,
          "Add another sign-in method before removing this passkey.",
        )
      }
      if (result === "not-found") return notFound(c, "Passkey not found.")
      return success(c)
    },
  )
  .patch(
    "/user",
    requireSession,
    tbValidator("json", UpdateUserBody),
    async (c) => {
      try {
        const updated = await updateUserIdentity(
          c.var.viewerId,
          c.req.valid("json"),
        )
        return c.json({ user: publicAuthUserRow(updated) })
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not update user.")
      }
    },
  )
  .delete("/user", requireAnySession, async (c) => {
    try {
      await deleteUserAccount(c.var.viewerId, "self")
      clearSessionCookies(c)
      return success(c)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Could not delete user.")
    }
  })
  .route("/desktop", authDesktopRoute)
  .route("/", authOAuthRoute)
