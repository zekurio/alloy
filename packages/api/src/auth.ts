import { passkeyClient } from "@better-auth/passkey/client"
import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  usernameClient,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export type AuthClient = ReturnType<typeof createAuth>

export function createAuth(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      inferAdditionalFields<
        never,
        {
          user: {
            banner: { type: "string"; required: false }
            disabledAt: { type: "date"; required: false }
            storageQuotaBytes: { type: "number"; required: false }
          }
        }
      >({
        user: {
          banner: {
            type: "string",
            required: false,
          },
          disabledAt: {
            type: "date",
            required: false,
          },
          storageQuotaBytes: {
            type: "number",
            required: false,
          },
        },
      }),
      adminClient(),
      usernameClient(),
      genericOAuthClient(),
      passkeyClient(),
    ],
  })
}
