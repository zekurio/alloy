import { userPasskey } from "@alloy/db/auth-schema"
import { createRegistrationUserInTransaction } from "@alloy/server/auth/identity"
import {
  passkeyPublicKey,
  serializeTransports,
} from "@alloy/server/auth/webauthn"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { RegistrationResponseJSON } from "@simplewebauthn/server"

type PasskeyRegistrationPayload = {
  email?: unknown
  username?: unknown
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
      setupFirstAdmin: payload.setupFirstAdmin === true,
    })

    await tx.insert(userPasskey).values({
      userId: row.id,
      credentialId: registrationInfo.credential.id,
      publicKey: passkeyPublicKey(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      transports: serializeTransports(response.response.transports),
      aaguid: registrationInfo.aaguid,
      name: `${row.username}'s passkey`,
    })

    return row
  })

  if (payload.setupFirstAdmin === true) {
    await configStore.set("setupComplete", true)
  }

  return row
}
