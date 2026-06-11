import type { OAuthProviderConfig, PublicAuthProvider } from "alloy-contracts"

import { isOAuthProviderUsable } from "../config/secret-store"
import { configStore } from "../config/store"

// Only enabled providers with a stored secret are usable for sign-in (see
// isOAuthProviderUsable). Enforcing it here means no config path (boot, reload,
// import, hand-edit) can surface an enabled-but-secretless provider.
export function getEnabledProviderConfigs(): OAuthProviderConfig[] {
  return configStore
    .get("oauthProviders")
    .filter((provider) => isOAuthProviderUsable(provider))
}

export function getEnabledProviderConfig(
  providerId: string,
): OAuthProviderConfig | null {
  const provider = configStore
    .get("oauthProviders")
    .find((candidate) => candidate.providerId === providerId)
  return provider && isOAuthProviderUsable(provider) ? provider : null
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
