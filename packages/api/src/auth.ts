import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { Auth } from "@workspace/server/auth"

export type AuthClient = ReturnType<typeof createAuth>

/**
 * Build a typed better-auth React client bound to the API server.
 *
 * Plugins mirror the server config — adding one here teaches `useSession`,
 * `signIn`, `authClient.admin.*`, and `authClient.signIn.oauth2` about the
 * extra surface without sacrificing type inference:
 *
 *   - `inferAdditionalFields<Auth>()` forwards custom user/session columns
 *     (e.g. the admin plugin's `role`, `banned`).
 *   - `adminClient()` exposes `authClient.admin.listUsers()`, `.setRole()`, …
 *   - `genericOAuthClient()` exposes `authClient.signIn.oauth2({ providerId })`
 *     for admin-configured custom OAuth providers.
 */
export function createAuth(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      inferAdditionalFields<Auth>(),
      adminClient(),
      genericOAuthClient(),
    ],
  })
}
