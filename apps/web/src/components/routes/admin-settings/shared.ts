import {
  type AdminOAuthProvider,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
} from "@workspace/api"

export function emptyProvider(): AdminOAuthProvider {
  return {
    providerId: "",
    displayName: "Custom OIDC",
    clientId: "",
    clientSecret: "",
    clientSecretSet: false,
    scopes: ["openid", "profile", "email"],
    enabled: true,
    buttonColor: "",
    buttonTextColor: "",
    iconUrl: "",
    discoveryUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    pkce: true,
    usernameClaim: "preferred_username",
    quotaClaim: OAUTH_QUOTA_CLAIM_DEFAULT,
    roleClaim: OAUTH_ROLE_CLAIM_DEFAULT,
  }
}

function normalizeAuthBaseURL(authBaseURL: string): string {
  return authBaseURL.endsWith("/") ? authBaseURL.slice(0, -1) : authBaseURL
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim()
}

export function callbackURLForProvider(
  authBaseURL: string,
  providerId: string,
): string {
  const normalizedProviderId = normalizeProviderId(providerId)
  return `${normalizeAuthBaseURL(authBaseURL)}/api/auth/oauth2/callback/${
    normalizedProviderId || "{providerId}"
  }`
}

export function toSubmissionProvider(
  provider: AdminOAuthProvider,
): AdminOAuthProvider {
  return {
    ...provider,
    providerId: normalizeProviderId(provider.providerId),
    displayName: provider.displayName.trim(),
    clientId: provider.clientId.trim(),
    // Write-only: blank means "keep the existing secret".
    clientSecret: emptyToUndefined(provider.clientSecret),
    buttonColor: normalizeHexColor(provider.buttonColor),
    buttonTextColor: normalizeHexColor(provider.buttonTextColor),
    iconUrl: emptyToUndefined(provider.iconUrl),
    scopes: normalizeScopes(provider.scopes),
    discoveryUrl: emptyToUndefined(provider.discoveryUrl),
    authorizationUrl: emptyToUndefined(provider.authorizationUrl),
    tokenUrl: emptyToUndefined(provider.tokenUrl),
    userInfoUrl: emptyToUndefined(provider.userInfoUrl),
    usernameClaim: emptyToUndefined(provider.usernameClaim),
    quotaClaim: emptyToUndefined(provider.quotaClaim),
    roleClaim: emptyToUndefined(provider.roleClaim),
  }
}

export function oauthProvidersEqual(
  left: AdminOAuthProvider,
  right: AdminOAuthProvider,
): boolean {
  return (
    JSON.stringify(toSubmissionProvider(left)) ===
      JSON.stringify(toSubmissionProvider(right))
  )
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function normalizeHexColor(value: string | undefined): string | undefined {
  const trimmed = emptyToUndefined(value)
  if (!trimmed) return undefined
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function trimString(value: string): string {
  return value.trim()
}

export function requiredTrimmedString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

export function isBlank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim().length === 0
}

export function normalizeScopes(
  scopes: readonly string[] | undefined,
): string[] | undefined {
  const normalized = scopes?.map((scope) => scope.trim()).filter(Boolean)
  return normalized && normalized.length > 0 ? normalized : undefined
}

export function isAllowedString<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T)
}

export function parseInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

export function isEvenIntegerInRange(
  value: number,
  min: number,
  max: number,
): boolean {
  return (
    Number.isInteger(value) && value >= min && value <= max && value % 2 === 0
  )
}

export function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = parseInteger(raw)
  if (n === null) return fallback
  return Math.min(max, Math.max(min, n))
}
