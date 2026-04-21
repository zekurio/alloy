import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"

import {
  configStore,
  type OAuthProviderConfig,
} from "./config-store"

export type PublicOAuthProvider = {
  providerId: string
  displayName: string
}

function getEnabledProvider(): OAuthProviderConfig | null {
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

function imageFromProfile(profile: Record<string, unknown>): string | undefined {
  for (const key of ["picture", "image", "avatar_url"] as const) {
    const candidate = profile[key]
    if (isImageUrl(candidate)) return candidate
  }
  return undefined
}

export function buildGenericOAuthConfig(): GenericOAuthConfig[] {
  const provider = getEnabledProvider()
  if (!provider) return []
  const { openRegistrations } = configStore.getAll()
  const claim = provider.usernameClaim
  return [
    {
      providerId: provider.providerId,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      scopes: provider.scopes,
      discoveryUrl: provider.discoveryUrl,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userInfoUrl: provider.userInfoUrl,
      pkce: provider.pkce,
      disableSignUp: !openRegistrations,
      mapProfileToUser: (profile) => {
        const rawProfile = profile as Record<string, unknown>
        const next: { name?: string; image?: string } = {}
        const rawName = rawProfile[claim]
        if (typeof rawName === "string" && rawName.length > 0) {
          next.name = rawName
        }
        const image = imageFromProfile(rawProfile)
        if (image) next.image = image
        return next
      },
    } satisfies GenericOAuthConfig,
  ]
}

export function buildTrustedProviders(): string[] {
  const provider = getEnabledProvider()
  return provider ? [provider.providerId] : []
}

export function getPublicProvider(): PublicOAuthProvider | null {
  const provider = getEnabledProvider()
  return provider
    ? {
        providerId: provider.providerId,
        displayName: provider.displayName,
      }
    : null
}
