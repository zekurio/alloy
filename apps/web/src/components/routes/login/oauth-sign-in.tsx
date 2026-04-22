import * as React from "react"

import { toast } from "@workspace/ui/components/sonner"

import { OAuthButton } from "@/components/auth/oauth-button"
import { authClient } from "@/lib/auth-client"

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
      await authClient.signIn.oauth2({
        providerId,
        callbackURL: `${window.location.origin}/`,
      })
    } catch (cause) {
      toast.error("OAuth sign-in failed", {
        description:
          cause instanceof Error
            ? cause.message
            : "We couldn't complete the redirect. Please try again.",
      })
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
