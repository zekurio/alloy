import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Callout } from "@alloy/ui/components/callout"
import { useRouter } from "@tanstack/react-router"
import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session || !open) return null

  async function onReactivate() {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      await api.users.reactivateAccount()
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't reactivate account")))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open}>
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
        <AlertDialogFooter className="grid-cols-1">
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
