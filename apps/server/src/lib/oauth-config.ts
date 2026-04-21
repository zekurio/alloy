import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"

import { configStore } from "./config-store"

export function buildGenericOAuthConfig(): GenericOAuthConfig[] {
  const { oauthProvider: p, openRegistrations } = configStore.getAll()
  if (!p) return []
  const claim = p.usernameClaim
  return [
    {
      providerId: p.providerId,
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      scopes: p.scopes,
      discoveryUrl: p.discoveryUrl,
      authorizationUrl: p.authorizationUrl,
      tokenUrl: p.tokenUrl,
      userInfoUrl: p.userInfoUrl,
      pkce: p.pkce,
      // Static first-line filter; the live gate is in auth.ts's hook.
      disableSignUp: !openRegistrations,
      mapProfileToUser: (profile) => {
        const raw = (profile as Record<string, unknown>)[claim]
        if (typeof raw === "string" && raw.length > 0) {
          return { name: raw }
        }
        return {}
      },
    },
  ]
}

/** Public (non-sensitive) view of the provider for `/api/auth-config`. */
export function getPublicProvider(): {
  providerId: string
  displayName: string
} | null {
  const provider = configStore.get("oauthProvider")
  if (!provider) return null
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
  }
}
