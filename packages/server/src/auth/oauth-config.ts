import type { OidcConfig, PublicOidcConfig } from "@alloy/contracts"
import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"

/**
 * The OIDC provider, when sign-in can use it: enabled and with a client
 * secret. Enforcing it here means no config path can surface an
 * enabled-but-secretless provider.
 */
export function usableOidcProvider(): OidcConfig | null {
  const oidc = configStore.get("oidc")
  if (!oidc.enabled || !secretStore.oidcClientSecret()) return null
  return oidc
}

export function requireUsableOidcProvider(): OidcConfig {
  const provider = usableOidcProvider()
  if (!provider) throw new Error("OAuth provider is not enabled.")
  return provider
}

export function publicOidcConfig(): PublicOidcConfig | null {
  const provider = usableOidcProvider()
  if (!provider) return null
  return {
    displayName: provider.displayName,
    allowSignUp: provider.allowSignUp,
  }
}
