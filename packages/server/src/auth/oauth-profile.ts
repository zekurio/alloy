import {
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  type OAuthProviderConfig,
  USER_ROLES,
  type UserRole,
} from "@alloy/contracts"
import { configStore } from "@alloy/server/config/store"
import {
  type Configuration,
  skipSubjectCheck,
  type TokenEndpointResponse,
  type UserInfoResponse,
} from "openid-client"

import { normalizeEmail } from "./identity"
import { fetchOAuthUserInfo } from "./oauth-client"
import type { OAuthProfile, StoredTokens } from "./oauth-types"

const GIB = 1024 ** 3

export async function profileFromTokens(
  config: Configuration,
  provider: OAuthProviderConfig,
  tokens: TokenEndpointResponse & {
    claims(): Record<string, unknown> | undefined
  },
): Promise<OAuthProfile> {
  const claims = tokens.claims() ?? {}
  const expectedSubject =
    typeof claims.sub === "string" ? claims.sub : skipSubjectCheck
  const userInfo = tokens.access_token
    ? await fetchOAuthUserInfo(
        config,
        provider,
        tokens.access_token,
        expectedSubject,
      )
    : ({} as UserInfoResponse)
  const raw = { ...claims, ...userInfo }
  const providerAccountId = stringClaim(raw, "sub") ?? stringClaim(raw, "id")
  const email = stringClaim(raw, "email")
  const normalizedEmail = email ? normalizeEmail(email) : null
  const usernameHint = stringClaim(
    raw,
    provider.usernameClaim ?? OAUTH_USERNAME_CLAIM_DEFAULT,
  )

  if (!providerAccountId) throw new Error("OAuth profile is missing a subject.")

  return {
    email: normalizedEmail,
    emailVerified: raw.email_verified === true || raw.verified === true,
    providerAccountId,
    raw,
    role: roleFromProfile(raw, provider.roleClaim),
    storageQuotaBytes: quotaFromProfile(raw, provider.quotaClaim),
    usernameHint,
  }
}

export function storedTokens(
  tokens: TokenEndpointResponse & { expiresIn(): number | undefined },
): StoredTokens {
  const expiresIn = tokens.expiresIn()
  return {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
    accessTokenExpiresAt:
      expiresIn === undefined ? null : new Date(Date.now() + expiresIn * 1000),
    scope: tokens.scope ?? null,
  }
}

function stringClaim(
  profile: Record<string, unknown>,
  key: string,
): string | null {
  if (!key) return null
  const value = profile[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function roleFromProfile(
  profile: Record<string, unknown>,
  claim = OAUTH_ROLE_CLAIM_DEFAULT,
): UserRole | undefined {
  const value = profile[claim]
  if (typeof value === "string") return roleFromString(value) ?? undefined
  if (Array.isArray(value)) {
    const roles = value
      .map((item) => (typeof item === "string" ? roleFromString(item) : null))
      .filter((role): role is UserRole => role !== null)
    return roles.includes("admin") ? "admin" : roles[0]
  }
  return undefined
}

function roleFromString(value: string): UserRole | null {
  const role = value.trim().toLowerCase()
  return USER_ROLES.includes(role as UserRole) ? (role as UserRole) : null
}

function quotaFromProfile(
  profile: Record<string, unknown>,
  claim = OAUTH_QUOTA_CLAIM_DEFAULT,
): number | null | undefined {
  const value = profile[claim]
  if (value === undefined || value === null || value === "") return undefined
  const gib =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(gib) || gib <= 0) return undefined
  const bytes = Math.round(gib * GIB)
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return undefined
  return bytes
}

export function defaultOAuthStorageQuota(): number | null {
  return configStore.get("limits").defaultStorageQuotaBytes
}
