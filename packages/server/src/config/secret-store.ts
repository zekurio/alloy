import type { OAuthProviderConfig } from "@alloy/contracts"
import { env } from "@alloy/server/env"

type SecretMap = {
  viewerCookieSecret: string
  uploadHmacSecret: string
  igdbClientId: string
  igdbClientSecret: string
}

export const secretStore = {
  get<K extends keyof SecretMap>(key: K): SecretMap[K] {
    return env[key]
  },
  /** Resolve an OAuth client secret by provider id ("" when unset). */
  oauthClientSecret(providerId: string): string {
    return env.oauthClientSecrets[providerId] ?? ""
  },
  hasOAuthClientSecret(providerId: string): boolean {
    return (env.oauthClientSecrets[providerId] ?? "").length > 0
  },
  storageS3Credentials(): {
    accessKeyId: string
    secretAccessKey: string
  } | null {
    return env.storageS3Credentials
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
