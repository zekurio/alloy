import type { UserRole } from "@alloy/contracts"
import type { JsonObject } from "openid-client"

export type OAuthMode = "sign-in" | "link"

export type OAuthChallengePayload = {
  browserNonce: string
  callbackURL: string
  codeVerifier?: string
  mode: OAuthMode
  providerId: string
  userId?: string
}

export type OAuthProfile = {
  avatarUrl: string | null
  email: string | null
  emailVerified: boolean
  providerAccountId: string
  raw: JsonObject
  role: UserRole | undefined
  storageQuotaBytes: number | null | undefined
  usernameHint: string | null
}

export type StoredTokens = {
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: Date | null
  scope: string | null
}
