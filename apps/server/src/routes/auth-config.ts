import { createHmac, timingSafeEqual } from "node:crypto"

import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { eq } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"
import { configStore } from "../lib/config-store"
import { getPublicProvider } from "../lib/oauth-config"
import { isSetupRequired } from "../lib/user-bootstrap"
import { env } from "../env"
import { USERNAME_MAX_LEN, USERNAME_MIN_LEN } from "../lib/username"

const PasskeySignUpRequestSchema = z.object({
  email: z.string().trim().email(),
  username: z
    .string()
    .trim()
    .min(USERNAME_MIN_LEN)
    .max(USERNAME_MAX_LEN)
    .regex(/^[a-z0-9_-]+$/),
})

type PasskeySignUpPayload = {
  email: string
  exp: number
  purpose: "passkey-sign-up"
  username: string
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function signPasskeySignUpPayload(payload: PasskeySignUpPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url")
  return `${encodedPayload}.${signature}`
}

export function verifyPasskeySignUpContext(
  context: string | null | undefined
): PasskeySignUpPayload {
  if (!context) throw new Error("Missing registration context.")
  const [encodedPayload, signature] = context.split(".")
  if (!encodedPayload || !signature) {
    throw new Error("Invalid registration context.")
  }

  const expectedSignature = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url")

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    )
  ) {
    throw new Error("Invalid registration context.")
  }

  const parsed = PasskeySignUpRequestSchema.extend({
    exp: z.number().int(),
    purpose: z.literal("passkey-sign-up"),
  }).parse(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")))

  if (parsed.exp <= Date.now()) {
    throw new Error("Registration request expired. Try again.")
  }

  return parsed
}

/**
 * Public config consumed by the login + setup pages. Narrow by design —
 * reachable without a session, so nothing sensitive.
 */
export const authConfigRoute = new Hono()
  .get("/", async (c) => {
    return c.json({
      setupRequired: await isSetupRequired(),
      openRegistrations: configStore.get("openRegistrations"),
      emailPasswordEnabled: configStore.get("emailPasswordEnabled"),
      passkeyEnabled: configStore.get("passkeyEnabled"),
      requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
      provider: getPublicProvider(),
    })
  })
  .post(
    "/passkey-sign-up",
    zValidator("json", PasskeySignUpRequestSchema),
    async (c) => {
      if (await isSetupRequired()) {
        return c.json({ error: "Complete initial setup first." }, 400)
      }
      if (!configStore.get("openRegistrations")) {
        return c.json({ error: "Sign-up is currently closed." }, 400)
      }
      if (!configStore.get("passkeyEnabled")) {
        return c.json({ error: "Passkey sign-up is currently disabled." }, 400)
      }

      const body = c.req.valid("json")
      const existing = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, body.email))
        .limit(1)
      if (existing.length > 0) {
        return c.json(
          { error: "An account already exists for that email address." },
          400
        )
      }
      const context = signPasskeySignUpPayload({
        email: body.email,
        exp: Date.now() + 15 * 60_000,
        purpose: "passkey-sign-up",
        username: body.username,
      })

      return c.json({ context })
    }
  )
