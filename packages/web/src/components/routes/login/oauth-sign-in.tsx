import type { PublicAuthProvider } from "@alloy/api"
import type { OAuthSignInAccount } from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { useMutation } from "@tanstack/react-query"

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
  const signIn = useMutation({
    // Resolves true once the browser is on its way to the provider.
    mutationFn: async () => {
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
      }
      return !error
    },
    onError: (cause) =>
      toastAuthAttemptFailure(
        "OAuth sign-in",
        message("OAuth sign-in failed"),
        cause,
      ),
  })
  const pending = signIn.isPending || signIn.data === true

  return (
    <OAuthButton
      providerId={provider.providerId}
      displayName={provider.displayName}
      pendingLabel={pending ? t("Redirecting…") : undefined}
      className="w-full"
      disabled={pending}
      onClick={() => {
        if (!pending) signIn.mutate()
      }}
    />
  )
}
