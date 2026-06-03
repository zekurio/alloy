import type { PublicAuthProvider } from "@workspace/contracts"

import { configStore, type OAuthProviderConfig } from "../config/store"

export function getEnabledProviderConfigs(): OAuthProviderConfig[] {
  return configStore.get("oauthProviders").filter((provider) =>
    provider.enabled
  )
}

export function getEnabledProviderConfig(
  providerId: string,
): OAuthProviderConfig | null {
  const provider = configStore.get("oauthProviders").find((candidate) =>
    candidate.providerId === providerId
  )
  return provider?.enabled ? provider : null
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
