import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import {
  USER_DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@workspace/contracts"
import { user, userPasskey } from "@workspace/db/auth-schema"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { clearSessionCookies, setSessionCookies } from "../auth/cookies"
import {
  assertCanRemoveAdmin,
  deleteUserPasskeyPreservingSignIn,
  findUserByEmail,
  normalizeEmail,
  setupRequired,
  updateUserIdentity,
  validateUsername,
} from "../auth/identity"
import { publicPasskeyRow } from "../auth/security-responses"
import {
  createSession,
  deleteCurrentSession,
  getSession,
  requireSession,
} from "../auth/session"
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  passkeyPublicKey,
  serializeTransports,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "../auth/webauthn"
import { db } from "../db"
import {
  badRequest,
  badRequestFromCause,
  internalServerError,
  notFound,
  success,
} from "../runtime/http-response"
import { authOAuthRoute } from "./auth-oauth-routes"
import { completePasskeySignUp } from "./auth-passkey-signup"
import { canOpenPasskeyRegistration, csrf } from "./auth-route-helpers"
import {
  optionalNullableBlankToNullTrimmedString,
  optionalTrimmedString,
  requiredTrimmedString,
  zValidator,
} from "./validation"

const SignUpOptionsBody = z.object({
  email: z.string().trim().email(),
  username: requiredTrimmedString(),
})

const PasskeyVerifyBody = z.object({
  challengeId: z.string().uuid(),
  response: z.unknown(),
})

const PasskeyNameBody = z.object({
  name: optionalNullableBlankToNullTrimmedString(64),
})

const UpdateUserBody = z.object({
  email: z.string().trim().email().optional(),
  name: optionalTrimmedString(USER_DISPLAY_NAME_MAX_LENGTH),
  username: z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .optional(),
})

const UuidParam = z.object({
  id: z.string().uuid(),
})

export const authRoute = new Hono()
  .use("*", csrf)
  .get("/session", async (c) => {
    return c.json(await getSession(c))
  })
  .post("/sign-out", async (c) => {
    await deleteCurrentSession(c)
    clearSessionCookies(c)
    return success(c)
  })
  .post(
    "/passkey/sign-up/options",
    zValidator("json", SignUpOptionsBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const setupFirstAdmin = await setupRequired()
        if (!setupFirstAdmin) {
          if (!(await canOpenPasskeyRegistration())) {
            return badRequest(c, "Passkey sign-up is currently disabled.")
          }
          const existing = await findUserByEmail(body.email)
          if (existing) {
            return badRequest(
              c,
              "An account already exists for that email address.",
            )
          }
        }

        const email = normalizeEmail(body.email)
        const username = validateUsername(body.username)
        const existing = await findUserByEmail(email)
        const registration = await beginPasskeyRegistration({
          identifier: email,
          payload: { email, username, setupFirstAdmin },
          user: {
            id: existing && setupFirstAdmin ? existing.id : crypto.randomUUID(),
            email,
            name:
              existing && setupFirstAdmin
                ? existing.name || username
                : username,
            username,
          },
        })
        return c.json(registration)
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not start sign-up.")
      }
    },
  )
  .post(
    "/passkey/sign-up/verify",
    zValidator("json", PasskeyVerifyBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const response = body.response as RegistrationResponseJSON
        const { payload, verification } = await verifyPasskeyRegistration({
          challengeId: body.challengeId,
          response,
        })
        if (!payload.email || !payload.username) {
          return badRequest(c, "Invalid registration request.")
        }
        const userRow = await completePasskeySignUp({
          payload,
          registrationInfo: verification.registrationInfo,
          response,
        })

        const { token, data } = await createSession(c, userRow.id)
        setSessionCookies(c, token)
        return c.json(data)
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not verify passkey.")
      }
    },
  )
  .post("/passkey/sign-in/options", async (c) => {
    try {
      return c.json(await beginPasskeyAuthentication())
    } catch (cause) {
      return badRequestFromCause(c, cause, "Could not start sign-in.")
    }
  })
  .post(
    "/passkey/sign-in/verify",
    zValidator("json", PasskeyVerifyBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const { credential, verification } = await verifyPasskeyAuthentication({
          challengeId: body.challengeId,
          response: body.response as AuthenticationResponseJSON,
        })
        const now = new Date()
        await db
          .update(userPasskey)
          .set({
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: now,
            updatedAt: now,
          })
          .where(eq(userPasskey.id, credential.id))
        const { token, data } = await createSession(c, credential.userId)
        setSessionCookies(c, token)
        return c.json(data)
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
        createdAt: userPasskey.createdAt,
        deviceType: userPasskey.deviceType,
      })
      .from(userPasskey)
      .where(eq(userPasskey.userId, c.var.viewerId))
      .orderBy(userPasskey.createdAt)
    return c.json(rows.map(publicPasskeyRow))
  })
  .post("/passkeys/options", requireSession, async (c) => {
    try {
      const passkeys = await db
        .select()
        .from(userPasskey)
        .where(eq(userPasskey.userId, c.var.viewerId))
      return c.json(
        await beginPasskeyRegistration({
          identifier: c.var.viewerId,
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
    zValidator("json", PasskeyVerifyBody.extend(PasskeyNameBody.shape)),
    async (c) => {
      try {
        const body = c.req.valid("json")
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
            userId: c.var.viewerId,
            credentialId: info.credential.id,
            publicKey: passkeyPublicKey(info.credential.publicKey),
            counter: info.credential.counter,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
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
    zValidator("param", UuidParam),
    zValidator("json", PasskeyNameBody),
    async (c) => {
      const { id } = c.req.valid("param")
      const { name } = c.req.valid("json")
      const [updated] = await db
        .update(userPasskey)
        .set({ name: name ?? null, updatedAt: new Date() })
        .where(
          and(eq(userPasskey.id, id), eq(userPasskey.userId, c.var.viewerId)),
        )
        .returning()
      if (!updated) return notFound(c, "Passkey not found.")
      return c.json(publicPasskeyRow(updated))
    },
  )
  .delete(
    "/passkeys/:id",
    requireSession,
    zValidator("param", UuidParam),
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
    zValidator("json", UpdateUserBody),
    async (c) => {
      try {
        const updated = await updateUserIdentity(
          c.var.viewerId,
          c.req.valid("json"),
        )
        return c.json({ user: updated })
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not update user.")
      }
    },
  )
  .delete("/user", requireSession, async (c) => {
    try {
      await assertCanRemoveAdmin(c.var.viewerId)
      await db.delete(user).where(eq(user.id, c.var.viewerId))
      clearSessionCookies(c)
      return success(c)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Could not delete user.")
    }
  })
  .route("/", authOAuthRoute)
