import type { OAuthProviderConfig } from "@alloy/contracts"
import { env } from "@alloy/server/env"

import { storedOAuthClientSecret } from "./store"

type SecretMap = {
  viewerCookieSecret: string
  uploadHmacSecret: string
  steamgriddbApiKey: string
}

export const secretStore = {
  get<K extends keyof SecretMap>(key: K): SecretMap[K] {
    return env[key]
  },
  /**
   * Resolve an OAuth client secret by provider id ("" when unset), from
   * whichever source owns the provider list (env JSON or the settings table).
   */
  oauthClientSecret(providerId: string): string {
    return storedOAuthClientSecret(providerId)
  },
  hasOAuthClientSecret(providerId: string): boolean {
    return storedOAuthClientSecret(providerId).length > 0
  },
} as const

/**
 * The single rule for "is this OAuth provider actually usable for sign-in":
 * enabled AND a client secret is present. `pendingSecret` covers secrets about
 * to be written in the same request (validate-before-commit).
 */
export function isOAuthProviderUsable(
  provider: Pick<OAuthProviderConfig, "providerId" | "enabled">,
  pendingSecret: (providerId: string) => boolean = () => false,
): boolean {
  return (
    provider.enabled &&
    (secretStore.hasOAuthClientSecret(provider.providerId) ||
      pendingSecret(provider.providerId))
  )
}
