import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { KeyRoundIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"

import { authClient } from "@/lib/auth-client"

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
        toast.error(error.message ?? "Passkey sign-in failed")
        setPending(false)
        return
      }
      await authClient.getSession()
      await router.invalidate()
      await navigate({ to: "/" })
    } catch {
      toast.error("Passkey sign-in failed")
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
