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

function isImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function imageFromProfile(
  profile: Record<string, unknown>,
): string | undefined {
  for (const key of ["picture", "image", "avatar_url"] as const) {
    const candidate = profile[key]
    if (isImageUrl(candidate)) return candidate
  }
  return undefined
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
