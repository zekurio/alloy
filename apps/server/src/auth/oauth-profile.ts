import {
  fetchUserInfo,
  skipSubjectCheck,
  type Configuration,
  type TokenEndpointResponse,
  type UserInfoResponse,
} from "openid-client"

import { OAUTH_QUOTA_CLAIM_DEFAULT } from "@workspace/contracts"

import { configStore, type OAuthProviderConfig } from "../config/store"
import { normalizeEmail } from "./identity"
import { imageFromProfile } from "./oauth-config"
import type { OAuthProfile, StoredTokens } from "./oauth-types"

const GIB = 1024 ** 3

export async function profileFromTokens(
  config: Configuration,
  provider: OAuthProviderConfig,
  tokens: TokenEndpointResponse & {
    claims(): Record<string, unknown> | undefined
  }
): Promise<OAuthProfile> {
  const claims = tokens.claims() ?? {}
  const expectedSubject =
    typeof claims.sub === "string" ? claims.sub : skipSubjectCheck
  const userInfo = tokens.access_token
    ? await fetchUserInfo(config, tokens.access_token, expectedSubject)
    : ({} as UserInfoResponse)
  const raw = { ...claims, ...userInfo }
  const providerAccountId = stringClaim(raw, "sub")
  const email = stringClaim(raw, "email")
  const usernameHint = stringClaim(raw, provider.usernameClaim ?? "")

  if (!providerAccountId) throw new Error("OAuth profile is missing a subject.")

  return {
    email: email ? normalizeEmail(email) : null,
    emailVerified: raw.email_verified === true,
    name:
      stringClaim(raw, "name") ??
      stringClaim(raw, "display_name") ??
      stringClaim(raw, "nickname") ??
      usernameHint ??
      email ??
      "Alloy user",
    picture: imageFromProfile(raw) ?? null,
    providerAccountId,
    raw,
    storageQuotaBytes: quotaFromProfile(raw, provider.quotaClaim),
    usernameHint,
  }
}

export function storedTokens(
  tokens: TokenEndpointResponse & { expiresIn(): number | undefined }
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
  key: string
): string | null {
  if (!key) return null
  const value = profile[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function quotaFromProfile(
  profile: Record<string, unknown>,
  claim = OAUTH_QUOTA_CLAIM_DEFAULT
): number | null | undefined {
  const value = profile[claim]
  if (value === undefined || value === null || value === "") return undefined
  const gib =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(gib) || gib < 0) return undefined
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(gib * GIB))
}

export function defaultOAuthStorageQuota(): number | null {
  return configStore.get("limits").defaultStorageQuotaBytes
}
