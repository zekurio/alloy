import { t } from "@alloy/contracts/schema"
import { userPasskey } from "@alloy/db/auth-schema"
import { completeAuthenticatedSignIn } from "@alloy/server/auth/account-sign-in"
import {
  clearAccountReactivationCookie,
  setSessionCookies,
} from "@alloy/server/auth/cookies"
import {
  deleteUserPasskeyPreservingSignIn,
  setupRequired,
  validateUsername,
} from "@alloy/server/auth/identity"
import {
  publicPasskeyRow,
  publicSessionData,
} from "@alloy/server/auth/security-responses"
import { createSession, requireSession } from "@alloy/server/auth/session"
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
} from "@alloy/server/runtime/http-response"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { StaticDecode } from "typebox"

import { completePasskeySignUp } from "./auth-passkey-signup"
import {
  authenticatedSignInResponse,
  canOpenPasskeyRegistration,
} from "./auth-route-helpers"
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

const UuidParam = t.object({
  id: t.string().uuid(),
})

async function verifyRegistrationBody(
  body: StaticDecode<typeof PasskeyRegistrationVerifyBody>,
) {
  // SAFETY: The request schema validates the WebAuthn wire fields.
  const response = body.response as RegistrationResponseJSON
  return {
    response,
    ...(await verifyPasskeyRegistration({
      challengeId: body.challengeId,
      response,
    })),
  }
}

export const authPasskeyRoutes = new Hono()
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
        const { payload, verification, response } =
          await verifyRegistrationBody(body)
        if (!payload.username) {
          return badRequest(c, "Invalid registration request.")
        }
        const userRow = await completePasskeySignUp({
          payload,
          registrationInfo: verification.registrationInfo,
          response,
        })

        const { tokens, data } = await createSession(c, userRow.id)
        clearAccountReactivationCookie(c)
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
        return authenticatedSignInResponse(
          c,
          await completeAuthenticatedSignIn(c, credential.user_id),
        )
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
        const { payload, verification } = await verifyRegistrationBody(body)
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
            transports: serializeTransports(body.response.response.transports),
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
