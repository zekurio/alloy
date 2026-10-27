import type { PublicAuthConfig } from "@alloy/api"

import type { Session } from "./session-suspense"

export function isAdmin(session: Session | null): boolean {
  // SAFETY: The auth API includes the optional role field on session users.
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

export function shouldForceOnboarding(
  config: PublicAuthConfig,
  session: Session | null,
): boolean {
  return (
    config.setupRequired && !config.adminAccountRequired && isAdmin(session)
  )
}

/** Providers whose first sign-in creates an account. */
export function signUpProviders(config: PublicAuthConfig) {
  return config.providers.filter((provider) => provider.allowSignUp)
}

/** Whether any sign-up method is open: passkeys or an OAuth provider. */
export function canSignUp(config: PublicAuthConfig): boolean {
  return (
    (config.openRegistrations && config.passkeyEnabled) ||
    signUpProviders(config).length > 0
  )
}
