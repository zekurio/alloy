export function oauthNotImplemented(): { error: string; status: 501 } {
  return {
    error: "OAuth sign-in is not implemented in this pass.",
    status: 501,
  }
}

export const getOAuthProviderConfig = oauthNotImplemented
export const startOAuthSignIn = oauthNotImplemented
export const finishOAuthCallback = oauthNotImplemented
export const linkOAuthAccount = oauthNotImplemented
export const unlinkOAuthAccount = oauthNotImplemented
