import type { UserRole } from "@workspace/contracts"

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
  email: string | null
  emailVerified: boolean
  name: string
  picture: string | null
  providerAccountId: string
  raw: Record<string, unknown>
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
