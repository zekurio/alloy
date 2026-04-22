import * as React from "react"
import { KeyRoundIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "@/lib/auth-client"

export function PasskeySignIn() {
  const [pending, setPending] = React.useState(false)

  async function onSignIn() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.passkey()
      if (error) {
        toast.error(error.message ?? "Passkey sign-in failed")
        setPending(false)
        return
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Passkey sign-in failed"
      )
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full justify-start gap-3"
      disabled={pending}
      onClick={onSignIn}
    >
      <KeyRoundIcon className="size-4" />
      <span className="truncate">
        {pending ? "Waiting for authenticator…" : "Continue with a passkey"}
      </span>
    </Button>
  )
}
