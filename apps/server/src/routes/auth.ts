import { zValidator } from "@hono/zod-validator"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { authAccount, user, userPasskey } from "@workspace/db/auth-schema"

import { db } from "../db"
import {
  clearOAuthStateCookie,
  clearSessionCookies,
  setOAuthStateCookie,
  setSessionCookies,
} from "../auth/cookies"
import {
  assertCanRemoveAdmin,
  deleteUserPasskeyPreservingSignIn,
  findUserByEmail,
  normalizeEmail,
  setupRequired,
  unlinkOAuthAccountPreservingSignIn,
  updateUserIdentity,
  validateUsername,
} from "../auth/identity"
import {
  fallbackOAuthErrorRedirect,
  finishOAuthCallback,
  startOAuthLink,
  startOAuthSignIn,
} from "../auth/oauth"
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
import { completePasskeySignUp } from "./auth-passkey-signup"
import {
  canOpenPasskeyRegistration,
  csrf,
  errorMessage,
} from "./auth-route-helpers"

const SignUpOptionsBody = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(1),
})

const PasskeyVerifyBody = z.object({
  challengeId: z.string().uuid(),
  response: z.unknown(),
})

const PasskeyNameBody = z.object({
  name: z.string().trim().max(64).optional().nullable(),
})

const UpdateUserBody = z.object({
  name: z.string().max(100).optional(),
  username: z.string().min(1).max(32).optional(),
})

const UuidParam = z.object({
  id: z.string().uuid(),
})

const UnlinkAccountBody = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1),
})

const OAuthStartBody = z.object({
  providerId: z.string().min(1),
  callbackURL: z.string().optional().nullable(),
})

export const authRoute = new Hono()
  .use("*", csrf)
  .get("/session", async (c) => {
    return c.json(await getSession(c))
  })
  .post("/sign-out", async (c) => {
    await deleteCurrentSession(c)
    clearSessionCookies(c)
    return c.json({ success: true })
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
            return c.json(
              { error: "Passkey sign-up is currently disabled." },
              400
            )
          }
          const existing = await findUserByEmail(body.email)
          if (existing) {
            return c.json(
              { error: "An account already exists for that email address." },
              400
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
        return c.json(
          { error: errorMessage(cause, "Could not start sign-up.") },
          400
        )
      }
    }
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
          return c.json({ error: "Invalid registration request." }, 400)
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
        return c.json(
          { error: errorMessage(cause, "Could not verify passkey.") },
          400
        )
      }
    }
  )
  .post("/passkey/sign-in/options", async (c) => {
    try {
      return c.json(await beginPasskeyAuthentication())
    } catch (cause) {
      return c.json(
        { error: errorMessage(cause, "Could not start sign-in.") },
        400
      )
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
        return c.json(
          { error: errorMessage(cause, "Passkey sign-in failed.") },
          400
        )
      }
    }
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
    return c.json(rows)
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
        })
      )
    } catch (cause) {
      return c.json(
        { error: errorMessage(cause, "Could not start passkey registration.") },
        400
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
          return c.json({ error: "Invalid passkey registration request." }, 400)
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
            name: body.name?.trim() || null,
          })
          .returning()
        return c.json(created)
      } catch (cause) {
        return c.json(
          { error: errorMessage(cause, "Could not add passkey.") },
          400
        )
      }
    }
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
        .set({ name: name?.trim() || null, updatedAt: new Date() })
        .where(
          and(eq(userPasskey.id, id), eq(userPasskey.userId, c.var.viewerId))
        )
        .returning()
      if (!updated) return c.json({ error: "Passkey not found." }, 404)
      return c.json(updated)
    }
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
        return c.json(
          { error: "Add another sign-in method before removing this passkey." },
          400
        )
      }
      if (result === "not-found")
        return c.json({ error: "Passkey not found." }, 404)
      return c.json({ success: true })
    }
  )
  .patch(
    "/user",
    requireSession,
    zValidator("json", UpdateUserBody),
    async (c) => {
      try {
        const updated = await updateUserIdentity(
          c.var.viewerId,
          c.req.valid("json")
        )
        return c.json({ user: updated })
      } catch (cause) {
        return c.json(
          { error: errorMessage(cause, "Could not update user.") },
          400
        )
      }
    }
  )
  .delete("/user", requireSession, async (c) => {
    try {
      await assertCanRemoveAdmin(c.var.viewerId)
      await db.delete(user).where(eq(user.id, c.var.viewerId))
      clearSessionCookies(c)
      return c.json({ success: true })
    } catch (cause) {
      return c.json(
        { error: errorMessage(cause, "Could not delete user.") },
        400
      )
    }
  })
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
  .post(
    "/oauth/sign-in",
    zValidator("json", OAuthStartBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const result = await startOAuthSignIn(body)
        setOAuthStateCookie(c, body.providerId, result.browserNonce)
        return c.json({ url: result.url })
      } catch (cause) {
        return c.json(
          { error: errorMessage(cause, "Could not start OAuth sign-in.") },
          400
        )
      }
    }
  )
  .post(
    "/oauth/link",
    requireSession,
    zValidator("json", OAuthStartBody),
    async (c) => {
      try {
        const body = c.req.valid("json")
        const result = await startOAuthLink({
          ...body,
          userId: c.var.viewerId,
        })
        setOAuthStateCookie(c, body.providerId, result.browserNonce)
        return c.json({ url: result.url })
      } catch (cause) {
        return c.json(
          { error: errorMessage(cause, "Could not start OAuth link.") },
          400
        )
      }
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
          { error: "Add another sign-in method before unlinking this account." },
          400
        )
      }
      if (result === "not-found")
        return c.json({ error: "Account not found." }, 404)
      return c.json({ success: true })
    }
  )
