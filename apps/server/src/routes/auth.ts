import { zValidator } from "@hono/zod-validator"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { authAccount, user, userPasskey } from "@workspace/db/auth-schema"

import { db } from "../db"
import { env } from "../env"
import { clearSessionCookies, setSessionCookies } from "../lib/auth/cookies"
import {
  assertCanRemoveAdmin,
  countUserPasskeys,
  createRegistrationUser,
  findUserByEmail,
  normalizeEmail,
  setupRequired,
  updateUserIdentity,
  validateUsername,
} from "../lib/auth/identity"
import { oauthNotImplemented } from "../lib/auth/oauth"
import {
  createSession,
  deleteCurrentSession,
  getSession,
  requireSession,
} from "../lib/auth/session"
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  passkeyPublicKey,
  serializeTransports,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "../lib/auth/webauthn"
import { configStore } from "../lib/config-store"

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

const csrf = createMiddleware(async (c, next) => {
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(c.req.method)) {
    await next()
    return
  }
  const origin = c.req.header("origin")
  if (origin && !env.TRUSTED_ORIGINS.includes(origin)) {
    return c.json({ error: "Forbidden" }, 403)
  }
  await next()
})

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

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
            return c.json({ error: "Passkey sign-up is currently disabled." }, 400)
          }
          if (await findUserByEmail(body.email)) {
            return c.json(
              { error: "An account already exists for that email address." },
              400
            )
          }
        }

        const email = normalizeEmail(body.email)
        const username = validateUsername(body.username)
        const existing = setupFirstAdmin ? await findUserByEmail(email) : null
        const registration = await beginPasskeyRegistration({
          identifier: email,
          payload: { email, username, setupFirstAdmin },
          user: {
            id: existing?.id ?? crypto.randomUUID(),
            email,
            name: existing?.name || username,
            username,
          },
        })
        return c.json(registration)
      } catch (cause) {
        return c.json({ error: errorMessage(cause, "Could not start sign-up.") }, 400)
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
        const existingBeforeCreate = await findUserByEmail(payload.email)
        let userRow: Awaited<ReturnType<typeof createRegistrationUser>> | null =
          null
        userRow = await createRegistrationUser({
          email: payload.email,
          username: payload.username,
          setupFirstAdmin: payload.setupFirstAdmin === true,
        })
        const info = verification.registrationInfo
        try {
          await db.insert(userPasskey).values({
            userId: userRow.id,
            credentialId: info.credential.id,
            publicKey: passkeyPublicKey(info.credential.publicKey),
            counter: info.credential.counter,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            transports: serializeTransports(response.response.transports),
            aaguid: info.aaguid,
            name: `${userRow.username}'s passkey`,
          })
        } catch (cause) {
          if (!existingBeforeCreate) {
            await db.delete(user).where(eq(user.id, userRow.id))
          }
          throw cause
        }
        const { token, data } = await createSession(c, userRow.id)
        setSessionCookies(c, token)
        return c.json(data)
      } catch (cause) {
        return c.json({ error: errorMessage(cause, "Could not verify passkey.") }, 400)
      }
    }
  )
  .post("/passkey/sign-in/options", async (c) => {
    try {
      return c.json(await beginPasskeyAuthentication())
    } catch (cause) {
      return c.json({ error: errorMessage(cause, "Could not start sign-in.") }, 400)
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
        return c.json({ error: errorMessage(cause, "Passkey sign-in failed.") }, 400)
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
      return c.json({ error: errorMessage(cause, "Could not start passkey registration.") }, 400)
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
        return c.json({ error: errorMessage(cause, "Could not add passkey.") }, 400)
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
        .where(and(eq(userPasskey.id, id), eq(userPasskey.userId, c.var.viewerId)))
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
      if ((await countUserPasskeys(c.var.viewerId)) <= 1) {
        return c.json(
          { error: "Add another sign-in method before removing this passkey." },
          400
        )
      }
      const [deleted] = await db
        .delete(userPasskey)
        .where(and(eq(userPasskey.id, id), eq(userPasskey.userId, c.var.viewerId)))
        .returning({ id: userPasskey.id })
      if (!deleted) return c.json({ error: "Passkey not found." }, 404)
      return c.json({ success: true })
    }
  )
  .patch("/user", requireSession, zValidator("json", UpdateUserBody), async (c) => {
    try {
      const updated = await updateUserIdentity(c.var.viewerId, c.req.valid("json"))
      return c.json({ user: updated })
    } catch (cause) {
      return c.json({ error: errorMessage(cause, "Could not update user.") }, 400)
    }
  })
  .delete("/user", requireSession, async (c) => {
    try {
      await assertCanRemoveAdmin(c.var.viewerId)
      await db.delete(user).where(eq(user.id, c.var.viewerId))
      clearSessionCookies(c)
      return c.json({ success: true })
    } catch (cause) {
      return c.json({ error: errorMessage(cause, "Could not delete user.") }, 400)
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
  .post("/oauth/link", requireSession, (c) => {
    const result = oauthNotImplemented()
    return c.json({ error: result.error }, result.status)
  })
  .post(
    "/accounts/unlink",
    requireSession,
    zValidator("json", UnlinkAccountBody),
    async (c) => {
      const body = c.req.valid("json")
      if ((await countUserPasskeys(c.var.viewerId)) === 0) {
        return c.json(
          { error: "Add a passkey before unlinking this account." },
          400
        )
      }
      const [deleted] = await db
        .delete(authAccount)
        .where(
          and(
            eq(authAccount.userId, c.var.viewerId),
            eq(authAccount.providerId, body.providerId),
            eq(authAccount.providerAccountId, body.accountId)
          )
        )
        .returning({ id: authAccount.id })
      if (!deleted) return c.json({ error: "Account not found." }, 404)
      return c.json({ success: true })
    }
  )

async function canOpenPasskeyRegistration(): Promise<boolean> {
  return configStore.get("openRegistrations") && configStore.get("passkeyEnabled")
}
