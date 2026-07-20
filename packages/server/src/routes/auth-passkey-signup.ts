import { userPasskey } from "@alloy/db/auth-schema"
import { createRegistrationUserInTransaction } from "@alloy/server/auth/identity"
import {
  passkeyPublicKey,
  serializeTransports,
} from "@alloy/server/auth/webauthn"
import { db } from "@alloy/server/db/index"
import type { RegistrationResponseJSON } from "@simplewebauthn/server"

type PasskeyRegistrationPayload = {
  email?: unknown
  username?: unknown
  displayName?: unknown
  setupFirstAdmin?: unknown
}

type PasskeyRegistrationInfo = {
  credential: {
    id: string
    publicKey: Uint8Array
    counter: number
  }
  credentialDeviceType: string
  credentialBackedUp: boolean
  aaguid: string
}

export async function completePasskeySignUp({
  payload,
  registrationInfo,
  response,
}: {
  payload: PasskeyRegistrationPayload
  registrationInfo: PasskeyRegistrationInfo
  response: RegistrationResponseJSON
}) {
  const row = await db.transaction(async (tx) => {
    const { user: row } = await createRegistrationUserInTransaction(tx, {
      email: String(payload.email ?? ""),
      username: String(payload.username ?? ""),
      displayName:
        typeof payload.displayName === "string"
          ? payload.displayName
          : undefined,
      setupFirstAdmin: payload.setupFirstAdmin === true,
    })

    await tx.insert(userPasskey).values({
      user_id: row.id,
      credential_id: registrationInfo.credential.id,
      public_key: passkeyPublicKey(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      device_type: registrationInfo.credentialDeviceType,
      backed_up: registrationInfo.credentialBackedUp,
      transports: serializeTransports(response.response.transports),
      aaguid: registrationInfo.aaguid,
      name: `${row.username}'s passkey`,
    })

    return row
  })

  return row
}
