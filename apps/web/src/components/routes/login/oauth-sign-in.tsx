import * as React from "react"

import { toast } from "@workspace/ui/lib/toast"

import { OAuthButton } from "@/components/auth/oauth-button"
import { authClient } from "@/lib/auth-client"
import { authCallbackUrl, reportAuthFlowFailure } from "@/lib/auth-flow"
import { errorMessage } from "@/lib/error-message"

type OAuthSignInProps = {
  providerId: string
  displayName: string
}

export function OAuthSignIn({ providerId, displayName }: OAuthSignInProps) {
  const [pending, setPending] = React.useState(false)

  async function onOAuth() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.oauth2({
        providerId,
        callbackURL: authCallbackUrl("/"),
      })
      if (error) toast.error(errorMessage(error, "OAuth sign-in failed"))
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("OAuth sign-in", "OAuth sign-in failed", cause)
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <OAuthButton
      providerId={providerId}
      displayName={displayName}
      className="w-full"
      disabled={pending}
      onClick={onOAuth}
    />
  )
}
