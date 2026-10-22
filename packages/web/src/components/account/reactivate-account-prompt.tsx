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
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { completeSignOutFlow } from "@/lib/auth-flow"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseSession } from "@/lib/session-suspense"

function isDisabledSessionUser(
  user: { disabledAt: string | null } | null | undefined,
): boolean {
  return Boolean(user?.disabledAt)
}

export function ReactivateAccountPrompt() {
  const session = useSuspenseSession()
  const navigate = useNavigate()
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
      signOut={() =>
        completeSignOutFlow({
          invalidateRouter: () => router.invalidate(),
          navigate: () => navigate({ to: "/login", replace: true }),
        })
      }
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

type DialogAction = "reactivate" | "sign-out"

/**
 * Offers reactivation plus one way out: `onDismiss` while signing in, or
 * `signOut` for a session that is already disabled and cannot just close it.
 */
function AccountReactivationDialog({
  open,
  onDismiss,
  reactivate,
  signOut,
}: {
  open: boolean
  onDismiss?: () => void
  reactivate: () => Promise<void>
  signOut?: () => Promise<void>
}) {
  const [pending, setPending] = useState<DialogAction | null>(null)
  const [error, setError] = useState<{
    action: DialogAction
    message: string
  } | null>(null)

  async function run(
    action: DialogAction,
    task: () => Promise<void>,
    fallback: string,
  ) {
    if (pending) return
    setError(null)
    setPending(action)
    try {
      await task()
    } catch (cause) {
      setError({ action, message: errorMessage(cause, fallback) })
    } finally {
      setPending(null)
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
            <span>{error.message}</span>
          </Callout>
        ) : null}
        <AlertDialogFooter
          className={onDismiss || signOut ? undefined : "grid-cols-1"}
        >
          {onDismiss ? (
            <AlertDialogCancel disabled={pending !== null}>
              {t("Cancel")}
            </AlertDialogCancel>
          ) : signOut ? (
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() =>
                void run("sign-out", signOut, t("Couldn't sign out"))
              }
            >
              {pending === "sign-out" ? t("Signing out…") : t("Sign out")}
            </Button>
          ) : null}
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              void run(
                "reactivate",
                reactivate,
                t("Couldn't reactivate account"),
              )
            }}
            disabled={pending !== null}
          >
            {pending === "reactivate"
              ? t("Reactivating…")
              : error?.action === "reactivate"
                ? t("Try again")
                : t("Reactivate account")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
