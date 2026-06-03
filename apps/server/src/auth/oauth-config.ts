import type { PublicAuthProvider } from "@workspace/contracts"

import { configStore, type OAuthProviderConfig } from "../config/store"
import { secretStore } from "../config/secret-store"

// A provider is only usable for sign-in when it is enabled AND has a stored
// client secret. Enforcing it here means no config path (boot, reload, import,
// hand-edit) can ever surface an enabled-but-secretless provider — it just
// won't appear or resolve.
function isUsableProvider(provider: OAuthProviderConfig): boolean {
  return provider.enabled &&
    secretStore.hasOAuthClientSecret(provider.providerId)
}

export function getEnabledProviderConfigs(): OAuthProviderConfig[] {
  return configStore.get("oauthProviders").filter(isUsableProvider)
}

export function getEnabledProviderConfig(
  providerId: string,
): OAuthProviderConfig | null {
  const provider = configStore.get("oauthProviders").find((candidate) =>
    candidate.providerId === providerId
  )
  return provider && isUsableProvider(provider) ? provider : null
}

export function getPublicProviders(): PublicAuthProvider[] {
  return getEnabledProviderConfigs().map((provider) => ({
    providerId: provider.providerId,
    displayName: provider.displayName,
    buttonColor: provider.buttonColor,
    buttonTextColor: provider.buttonTextColor,
    iconUrl: provider.iconUrl,
  }))
}
