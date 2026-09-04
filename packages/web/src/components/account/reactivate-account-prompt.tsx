import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Callout } from "@alloy/ui/components/callout"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseSession } from "@/lib/session-suspense"

function isDisabledSessionUser(
  user: { disabledAt: string | null } | null | undefined,
): boolean {
  return Boolean(user?.disabledAt)
}

export function ReactivateAccountPrompt() {
  const session = useSuspenseSession()
  const router = useRouter()
  const open = isDisabledSessionUser(session?.user)

  if (!session || !open) return null

  return (
    <AccountReactivationDialog
      open
      reactivate={async () => {
        await api.users.reactivateAccount()
        await authClient.getSession()
        await router.invalidate()
      }}
    />
  )
}

export function SignInReactivationPrompt({
  open,
  redirectTo,
  onDismiss,
}: {
  open: boolean
  redirectTo?: string
  onDismiss: () => void
}) {
  const navigate = useNavigate()
  const router = useRouter()

  return (
    <AccountReactivationDialog
      open={open}
      onDismiss={onDismiss}
      reactivate={async () => {
        const { error } = await authClient.signIn.reactivate()
        if (error) throw error
        await router.invalidate()
        if (redirectTo) {
          window.location.assign(redirectTo)
        } else {
          await navigate({ to: "/", replace: true })
        }
      }}
    />
  )
}

function AccountReactivationDialog({
  open,
  onDismiss,
  reactivate,
}: {
  open: boolean
  onDismiss?: () => void
  reactivate: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onReactivate() {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      await reactivate()
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't reactivate account")))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss?.()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Reactivate your account?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "Your profile and clips are hidden while your account is disabled.",
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Callout tone="destructive">
            <CircleAlertIcon />
            <span>{error}</span>
          </Callout>
        ) : null}
        <AlertDialogFooter className={onDismiss ? undefined : "grid-cols-1"}>
          {onDismiss ? (
            <AlertDialogCancel disabled={pending}>
              {t("Cancel")}
            </AlertDialogCancel>
          ) : null}
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              void onReactivate()
            }}
            disabled={pending}
          >
            {pending
              ? t("Reactivating…")
              : error
                ? t("Try again")
                : t("Reactivate account")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
