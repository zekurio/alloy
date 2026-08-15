import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  type OAuthProviderConfig,
  USER_ROLES,
  type UserRole,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { configStore } from "@alloy/server/config/store"
import {
  type Configuration,
  type JsonObject,
  skipSubjectCheck,
  type TokenEndpointResponse,
} from "openid-client"

import { normalizeEmail } from "./identity"
import { fetchOAuthUserInfo } from "./oauth-client"
import type { OAuthProfile, StoredTokens } from "./oauth-types"

const GIB = 1024 ** 3
const OAuthStringClaimSchema = t.string()
const OAuthQuotaClaimSchema = t.union([t.string(), t.number()])

export async function profileFromTokens(
  config: Configuration,
  provider: OAuthProviderConfig,
  tokens: TokenEndpointResponse & {
    claims(): JsonObject | undefined
  },
): Promise<OAuthProfile> {
  const claims = tokens.claims() ?? {}
  const expectedSubject = stringClaim(claims, "sub") ?? skipSubjectCheck
  const userInfo =
    provider.fetchUserInfo !== false && tokens.access_token
      ? await fetchOAuthUserInfo(
          config,
          provider,
          tokens.access_token,
          expectedSubject,
        )
      : {}
  const raw = { ...claims, ...userInfo }
  const uidClaim = provider.uidClaim ?? "sub"
  const providerAccountId =
    stringClaim(raw, uidClaim) ??
    (uidClaim === "sub" ? stringClaim(raw, "id") : null)
  const email = stringClaim(raw, "email")
  const normalizedEmail = email ? normalizeEmail(email) : null
  const usernameHint = stringClaim(
    raw,
    provider.usernameClaim ?? OAUTH_USERNAME_CLAIM_DEFAULT,
  )

  if (!providerAccountId) throw new Error("OAuth profile is missing a subject.")

  return {
    avatarUrl: httpUrlClaim(
      raw,
      provider.avatarClaim ?? OAUTH_AVATAR_CLAIM_DEFAULT,
    ),
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

function stringClaim(profile: JsonObject, key: string): string | null {
  if (!key) return null
  const parsed = OAuthStringClaimSchema.safeParse(profile[key])
  return parsed.success && parsed.data.trim().length > 0
    ? parsed.data.trim()
    : null
}

function httpUrlClaim(profile: JsonObject, key: string): string | null {
  const value = stringClaim(profile, key)
  if (!value || !URL.canParse(value)) return null
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  return url.toString()
}

function roleFromProfile(
  profile: JsonObject,
  claim = OAUTH_ROLE_CLAIM_DEFAULT,
): UserRole | undefined {
  const value = profile[claim]
  const stringValue = OAuthStringClaimSchema.safeParse(value)
  if (stringValue.success) return roleFromString(stringValue.data) ?? undefined
  if (Array.isArray(value)) {
    const roles = value
      .map((item) => {
        const parsed = OAuthStringClaimSchema.safeParse(item)
        return parsed.success ? roleFromString(parsed.data) : null
      })
      .filter((role): role is UserRole => role !== null)
    return roles.includes("admin") ? "admin" : roles[0]
  }
  return undefined
}

function roleFromString(value: string): UserRole | null {
  const role = value.trim().toLowerCase()
  return USER_ROLES.find((userRole) => userRole === role) ?? null
}

function quotaFromProfile(
  profile: JsonObject,
  claim = OAUTH_QUOTA_CLAIM_DEFAULT,
): number | null | undefined {
  const value = profile[claim]
  if (value === undefined || value === null || value === "") return undefined
  const parsed = OAuthQuotaClaimSchema.safeParse(value)
  const gib = parsed.success ? Number(parsed.data) : Number.NaN
  if (!Number.isFinite(gib) || gib <= 0) return undefined
  const bytes = Math.round(gib * GIB)
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return undefined
  return bytes
}

export function defaultOAuthStorageQuota(): number | null {
  return configStore.get("limits").defaultStorageQuotaBytes
}
