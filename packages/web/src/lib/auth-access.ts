import type { PublicAuthConfig } from "@alloy/api"

import type { Session } from "./session-suspense"

export function isAdmin(session: Session | null): boolean {
  // SAFETY: The auth API includes the optional role field on session users.
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

/** Whether the first SSO sign-in of an unlinked identity creates an account. */
export function canOidcSignUp(config: PublicAuthConfig): boolean {
  return config.oidc?.allowSignUp === true
}

/** Whether any sign-up method is open: passkeys or SSO. */
export function canSignUp(config: PublicAuthConfig): boolean {
  return (
    (config.openRegistrations && config.passkeyEnabled) || canOidcSignUp(config)
  )
}
