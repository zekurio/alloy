import type { UserRole } from "@alloy/contracts"

export type OAuthMode = "sign-in" | "link"

export type OAuthChallengePayload = {
  browserNonce: string
  callbackURL: string
  codeVerifier?: string
  mode: OAuthMode
  userId?: string
}

export type OAuthProfile = {
  avatarUrl: string | null
  providerAccountId: string
  /** Unset when the provider sent no usable role claim. */
  role?: UserRole
  /** Unset when the provider sent no usable quota claim. */
  storageQuotaBytes?: number | null
  usernameHint: string | null
}
