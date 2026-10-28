import type { OAuthSignInAccount, UserRole } from "@alloy/contracts"

export type OAuthMode = "sign-in" | "link"

export type OAuthChallengePayload = {
  /** Sign-in only. */
  account?: OAuthSignInAccount
  browserNonce: string
  callbackURL: string
  codeVerifier?: string
  mode: OAuthMode
  providerId: string
  /** Sign-in only: create the first admin from this identity. */
  setupFirstAdmin?: boolean
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
