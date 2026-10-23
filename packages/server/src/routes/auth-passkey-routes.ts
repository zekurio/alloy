import { t } from "@alloy/contracts/schema"
import { completeAuthenticatedSignIn } from "@alloy/server/auth/account-sign-in"
import {
  clearAccountReactivationCookie,
  setSessionCookie,
} from "@alloy/server/auth/cookies"
import {
  deleteUserPasskeyPreservingSignIn,
  setupRequired,
  validateUsername,
} from "@alloy/server/auth/identity"
import {
  createPasskeyAccount,
  insertUserPasskey,
  listUserPasskeys,
  renameUserPasskey,
  selectUserPasskeys,
} from "@alloy/server/auth/passkeys"
import {
  publicPasskeyRow,
  publicSessionData,
} from "@alloy/server/auth/security-responses"
import { createSession, requireSession } from "@alloy/server/auth/session"
import {
  AUTHENTICATOR_TRANSPORTS,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "@alloy/server/auth/webauthn"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  badRequestFromCause,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { Hono } from "hono"
import type { StaticDecode } from "typebox"

import {
  authenticatedSignInResponse,
  canOpenPasskeyRegistration,
} from "./auth-route-helpers"
import {
  IdParam,
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
      transports: t.array(t.enum(AUTHENTICATOR_TRANSPORTS)).optional(),
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

function verifyRegistrationBody(
  body: StaticDecode<typeof PasskeyRegistrationVerifyBody>,
) {
  return verifyPasskeyRegistration({
    challengeId: body.challengeId,
    // SAFETY: The request schema validates the WebAuthn wire fields.
    response: body.response as RegistrationResponseJSON,
  })
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
        const registration = await verifyRegistrationBody(c.req.valid("json"))
        const { username, setupFirstAdmin } = registration.payload
        if (!username) {
          return badRequest(c, "Invalid registration request.")
        }
        const userRow = await createPasskeyAccount({
          username,
          setupFirstAdmin: setupFirstAdmin === true,
          registration,
        })

        const { token, data } = await createSession(c, userRow.id)
        clearAccountReactivationCookie(c)
        setSessionCookie(c, token)
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
        const credential = await verifyPasskeyAuthentication({
          challengeId: body.challengeId,
          response: body.response as AuthenticationResponseJSON,
        })
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
    const rows = await listUserPasskeys(c.var.viewerId)
    return c.json(rows.map(publicPasskeyRow))
  })
  .post("/passkeys/options", requireSession, async (c) => {
    try {
      return c.json(
        await beginPasskeyRegistration({
          identifier: c.var.viewerId,
          origin: c.req.header("origin"),
          payload: { userId: c.var.viewerId },
          user: {
            ...c.var.session.user,
            passkeys: await selectUserPasskeys(c.var.viewerId),
          },
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
        const registration = await verifyRegistrationBody(body)
        if (registration.payload.userId !== c.var.viewerId) {
          return badRequest(c, "Invalid passkey registration request.")
        }
        const created = await insertUserPasskey(db, {
          userId: c.var.viewerId,
          registration,
          name: body.name ?? null,
        })
        return c.json(publicPasskeyRow(created))
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not add passkey.")
      }
    },
  )
  .patch(
    "/passkeys/:id",
    requireSession,
    tbValidator("param", IdParam),
    tbValidator("json", PasskeyNameBody),
    async (c) => {
      const updated = await renameUserPasskey({
        userId: c.var.viewerId,
        passkeyId: c.req.valid("param").id,
        name: c.req.valid("json").name ?? null,
      })
      if (!updated) return notFound(c, "Passkey not found.")
      return c.json(publicPasskeyRow(updated))
    },
  )
  .delete(
    "/passkeys/:id",
    requireSession,
    tbValidator("param", IdParam),
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
