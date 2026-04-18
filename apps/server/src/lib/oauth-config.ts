import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"

import { configStore } from "./config-store"

/**
 * Translate the runtime-config OAuth provider into the shape better-auth's
 * `genericOAuth` plugin expects. At most one provider — product decision,
 * not a library limit; keeps the login surface to a single button.
 */
export function buildGenericOAuthConfig(): GenericOAuthConfig[] {
  const { oauthProvider: p, openRegistrations } = configStore.getAll()
  if (!p) return []
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
    },
  ]
}

/** Public (non-sensitive) view of the provider for `/api/auth-config`. */
export function getPublicProvider(): {
  providerId: string
  buttonText: string
} | null {
  const provider = configStore.get("oauthProvider")
  if (!provider) return null
  return {
    providerId: provider.providerId,
    buttonText: provider.buttonText,
  }
}
