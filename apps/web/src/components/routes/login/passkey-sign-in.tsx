import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { KeyRoundIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"

import { authClient } from "@/lib/auth-client"
import { completeAuthSessionFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { errorMessage } from "@/lib/error-message"

export function PasskeySignIn() {
  const [pending, setPending] = React.useState(false)
  const navigate = useNavigate()
  const router = useRouter()

  async function onSignIn() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.passkey()
      if (error) {
        toast.error(errorMessage(error, "Passkey sign-in failed"))
        setPending(false)
        return
      }
      await completeAuthSessionFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () => navigate({ to: "/" }),
      })
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure(
          "passkey sign-in",
          "Passkey sign-in failed",
          cause,
        ),
      )
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full gap-3"
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
