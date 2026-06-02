import * as React from "react"

import { toast } from "@workspace/ui/lib/toast"
import type { PublicAuthProvider } from "@workspace/api"

import { OAuthButton } from "@/components/auth/oauth-button"
import { authClient } from "@/lib/auth-client"
import { authCallbackUrl, reportAuthFlowFailure } from "@/lib/auth-flow"
import { errorMessage } from "@/lib/error-message"

type OAuthSignInProps = {
  provider: PublicAuthProvider
}

export function OAuthSignIn({ provider }: OAuthSignInProps) {
  const [pending, setPending] = React.useState(false)

  async function onOAuth() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.oauth2({
        providerId: provider.providerId,
        callbackURL: authCallbackUrl("/"),
      })
      if (error) {
        toast.error(errorMessage(error, "OAuth sign-in failed"))
        setPending(false)
      }
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("OAuth sign-in", "OAuth sign-in failed", cause),
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
      pendingLabel={pending ? "Redirecting…" : undefined}
      className="w-full"
      disabled={pending}
      onClick={onOAuth}
    />
  )
}
