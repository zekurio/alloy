import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  usernameClient,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { Auth } from "@workspace/server/auth"

export type AuthClient = ReturnType<typeof createAuth>

export function createAuth(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      inferAdditionalFields<Auth>(),
      adminClient(),
      usernameClient(),
      genericOAuthClient(),
    ],
  })
}
