import { useRouter } from "@tanstack/react-router"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "alloy-ui/components/alert-dialog"
import { toast } from "alloy-ui/lib/toast"
import * as React from "react"

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
  const [open, setOpen] = React.useState(() =>
    isDisabledSessionUser(session?.user),
  )
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    setOpen(isDisabledSessionUser(session?.user))
  }, [session?.user])

  if (!session || !open) return null

  async function onReactivate() {
    if (pending) return
    setPending(true)
    try {
      await api.users.reactivateAccount()
      toast.success("Account reactivated")
      setOpen(false)
      await router.invalidate()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't reactivate account"))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reactivate your account?</AlertDialogTitle>
          <AlertDialogDescription>
            Your profile and clips are hidden while your account is disabled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid-cols-1">
          <AlertDialogAction onClick={onReactivate} disabled={pending}>
            {pending ? "Reactivating…" : "Reactivate account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
