import type { PublicAuthProvider } from "@alloy/api"
import type { OAuthSignInAccount } from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { useState } from "react"

import { OAuthButton } from "@/components/auth/oauth-button"
import { authClient } from "@/lib/auth-client"
import { authCallbackUrl, toastAuthAttemptFailure } from "@/lib/auth-flow"

type OAuthSignInProps = {
  provider: PublicAuthProvider
  /** Same-origin return target (desktop browser-login handshake). */
  redirectTo?: string
  account?: OAuthSignInAccount
}

export function OAuthSignIn({
  provider,
  redirectTo,
  account,
}: OAuthSignInProps) {
  const [pending, setPending] = useState(false)

  async function onOAuth() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.oauth2({
        providerId: provider.providerId,
        callbackURL: authCallbackUrl(redirectTo ?? "/"),
        account,
      })
      if (error) {
        toastAuthAttemptFailure(
          "OAuth sign-in",
          message("OAuth sign-in failed"),
          error,
        )
        setPending(false)
      }
    } catch (cause) {
      toastAuthAttemptFailure(
        "OAuth sign-in",
        message("OAuth sign-in failed"),
        cause,
      )
      setPending(false)
    }
  }

  return (
    <OAuthButton
      providerId={provider.providerId}
      displayName={provider.displayName}
      buttonColor={provider.buttonColor}
      buttonTextColor={provider.buttonTextColor}
      iconUrl={provider.iconUrl}
      pendingLabel={pending ? t("Redirecting…") : undefined}
      className="w-full"
      disabled={pending}
      onClick={onOAuth}
    />
  )
}
