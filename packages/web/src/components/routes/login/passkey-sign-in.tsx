import { AUTH_ERROR_CODES } from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { useMutation } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { KeyRoundIcon } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import {
  completeAuthSessionFlow,
  toastAuthAttemptFailure,
} from "@/lib/auth-flow"

export function PasskeySignIn({
  redirectTo,
  onReactivationRequired,
}: {
  redirectTo?: string
  onReactivationRequired?: () => void
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const signIn = useMutation({
    // Resolves true once signed in and on the way to the redirect target.
    mutationFn: async () => {
      const { error } = await authClient.signIn.passkey()
      if (error) {
        if (
          error.code === AUTH_ERROR_CODES.accountReactivationRequired &&
          onReactivationRequired
        ) {
          onReactivationRequired()
        } else {
          toastAuthAttemptFailure(
            "passkey sign-in",
            message("Passkey sign-in failed"),
            error,
          )
        }
        return false
      }
      await completeAuthSessionFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () =>
          redirectTo
            ? window.location.assign(redirectTo)
            : navigate({ to: "/" }),
      })
      return true
    },
    onError: (cause) =>
      toastAuthAttemptFailure(
        "passkey sign-in",
        message("Passkey sign-in failed"),
        cause,
      ),
  })
  const pending = signIn.isPending || signIn.data === true

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full gap-3"
      disabled={pending}
      onClick={() => {
        if (!pending) signIn.mutate()
      }}
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
