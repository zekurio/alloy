import { encodedPathSegment } from "./paths"

export const AUTH_PATHS = {
  session: "/api/auth/session",
  signOut: "/api/auth/sign-out",
  reactivate: "/api/auth/reactivate",
  user: "/api/auth/user",
  userTheme: "/api/auth/user/theme",
  accounts: "/api/auth/accounts",
  accountsUnlink: "/api/auth/accounts/unlink",
  oauthLink: "/api/auth/oauth/link",
  oauthSignIn: "/api/auth/oauth/sign-in",
  passkeys: "/api/auth/passkeys",
  passkeyOptions: "/api/auth/passkeys/options",
  passkeyVerify: "/api/auth/passkeys/verify",
  passkeySignInOptions: "/api/auth/passkey/sign-in/options",
  passkeySignInVerify: "/api/auth/passkey/sign-in/verify",
  passkeySignUpOptions: "/api/auth/passkey/sign-up/options",
  passkeySignUpVerify: "/api/auth/passkey/sign-up/verify",
  passkey(id: string): string {
    return `/api/auth/passkeys/${encodedPathSegment(id)}`
  },
  sessions: "/api/auth/sessions",
  sessionsRevokeOthers: "/api/auth/sessions/revoke-others",
  sessionById(id: string): string {
    return `/api/auth/sessions/${encodedPathSegment(id)}`
  },
} as const
