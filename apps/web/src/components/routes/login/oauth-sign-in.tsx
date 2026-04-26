import * as React from "react"

import { toast } from "@workspace/ui/lib/toast"

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
      const { error } = await authClient.signIn.oauth2({
        providerId,
        callbackURL: `${window.location.origin}/`,
      })
      if (error) toast.error(error.message)
    } catch {
      toast.error("OAuth sign-in failed")
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
