import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { KeyRoundIcon } from "lucide-react"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import {
  completeAuthSessionFlow,
  toastAuthAttemptFailure,
} from "@/lib/auth-flow"

export function PasskeySignIn({ redirectTo }: { redirectTo?: string }) {
  const [pending, setPending] = useState(false)
  const navigate = useNavigate()
  const router = useRouter()

  async function onSignIn() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.signIn.passkey()
      if (error) {
        toastAuthAttemptFailure(
          "passkey sign-in",
          "Passkey sign-in failed",
          error,
        )
        setPending(false)
        return
      }
      await completeAuthSessionFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () =>
          redirectTo
            ? window.location.assign(redirectTo)
            : navigate({ to: "/" }),
      })
    } catch (cause) {
      toastAuthAttemptFailure(
        "passkey sign-in",
        "Passkey sign-in failed",
        cause,
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
      onFocus={authClient.signIn.preloadPasskey}
      onPointerEnter={authClient.signIn.preloadPasskey}
    >
      <KeyRoundIcon className="size-4" />
      <span className="truncate">
        {pending
          ? t("Waiting for authenticator…")
          : t("Continue with a passkey")}
      </span>
    </Button>
  )
}
