import {
  OIDC_PROVIDER_ID,
  type OAuthProviderConfig,
  type PublicAuthProvider,
} from "@alloy/contracts"
import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"

/**
 * The OIDC provider, when sign-in can use it: enabled and with a client
 * secret. Enforcing it here means no config path can surface an
 * enabled-but-secretless provider.
 */
export function usableOidcProvider(): OAuthProviderConfig | null {
  const oidc = configStore.get("oidc")
  if (!oidc.enabled || !secretStore.oidcClientSecret()) return null
  return { ...oidc, providerId: OIDC_PROVIDER_ID }
}

export function getEnabledProviderConfig(
  providerId: string,
): OAuthProviderConfig | null {
  return providerId === OIDC_PROVIDER_ID ? usableOidcProvider() : null
}

export function getPublicProviders(): PublicAuthProvider[] {
  const provider = usableOidcProvider()
  if (!provider) return []
  return [
    {
      providerId: provider.providerId,
      displayName: provider.displayName,
      allowSignUp: provider.allowSignUp,
    },
  ]
}
