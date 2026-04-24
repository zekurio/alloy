import type { AdminOAuthProvider } from "@workspace/api"

export function emptyProvider(): AdminOAuthProvider {
  return {
    providerId: "",
    displayName: "Custom OIDC",
    clientId: "",
    clientSecret: "",
    scopes: ["openid", "profile", "email"],
    enabled: true,
    discoveryUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    pkce: true,
    usernameClaim: "preferred_username",
  }
}

function normalizeAuthBaseURL(authBaseURL: string): string {
  return authBaseURL.endsWith("/") ? authBaseURL.slice(0, -1) : authBaseURL
}

export function callbackURLForProvider(
  authBaseURL: string,
  providerId: string
): string {
  return `${normalizeAuthBaseURL(authBaseURL)}/api/auth/oauth2/callback/${
    providerId || "{providerId}"
  }`
}

export function toSubmissionProvider(
  provider: AdminOAuthProvider
): AdminOAuthProvider {
  return {
    ...provider,
    providerId: provider.providerId.trim(),
    displayName: provider.displayName.trim(),
    clientId: provider.clientId.trim(),
    clientSecret: provider.clientSecret.trim(),
    scopes: provider.scopes?.map((scope) => scope.trim()).filter(Boolean),
    discoveryUrl: emptyToUndefined(provider.discoveryUrl),
    authorizationUrl: emptyToUndefined(provider.authorizationUrl),
    tokenUrl: emptyToUndefined(provider.tokenUrl),
    userInfoUrl: emptyToUndefined(provider.userInfoUrl),
    usernameClaim: emptyToUndefined(provider.usernameClaim),
  }
}

export function emptyToUndefined(
  value: string | undefined
): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
