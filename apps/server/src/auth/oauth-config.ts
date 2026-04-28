import type { PublicAuthProvider } from "@workspace/contracts"

import { configStore, type OAuthProviderConfig } from "../config/store"

export function getEnabledProviderConfig(): OAuthProviderConfig | null {
  const provider = configStore.get("oauthProvider")
  return provider && provider.enabled ? provider : null
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
  profile: Record<string, unknown>
): string | undefined {
  for (const key of ["picture", "image", "avatar_url"] as const) {
    const candidate = profile[key]
    if (isImageUrl(candidate)) return candidate
  }
  return undefined
}

export function getPublicProvider(): PublicAuthProvider | null {
  const provider = getEnabledProviderConfig()
  return provider
    ? {
        providerId: provider.providerId,
        displayName: provider.displayName,
      }
    : null
}
