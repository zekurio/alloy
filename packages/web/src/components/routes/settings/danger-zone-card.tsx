import { t as tx } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { EyeOffIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { api } from "@/lib/api"
import { authClient, signOut } from "@/lib/auth-client"
import { clientLogger } from "@/lib/client-log"
import { errorMessage } from "@/lib/error-message"
import { resetClientState } from "@/lib/query-client"
import { useSuspenseSession } from "@/lib/session-suspense"

function useAccountDangerActions() {
  const router = useRouter()
  const navigate = useNavigate()
  const session = useSuspenseSession()
  const [pendingAction, setPendingAction] = React.useState<
    "disable" | "reactivate" | "delete" | null
  >(null)
  // The session user already carries `disabledAt`, so seed from it rather than
  // an isolated fetch that flashes a loading row each time the card mounts. The
  // handlers below keep it current after a disable/reactivate.
  const [disabledAt, setDisabledAt] = React.useState<string | null>(
    session?.user.disabledAt ?? null,
  )

  const pending = pendingAction !== null

  async function onDisable() {
    if (pending) return
    setPendingAction("disable")
    try {
      const state = await api.users.disableAccount()
      setDisabledAt(state.disabledAt)
      toast.success(tx("Account disabled"))
      try {
        await signOut()
      } catch (cause) {
        clientLogger.warn("[account] Failed to sign out after disable.", cause)
      }
      resetClientState()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't disable account")))
    } finally {
      setPendingAction(null)
    }
  }

  async function onReactivate() {
    if (pending) return
    setPendingAction("reactivate")
    try {
      await api.users.reactivateAccount()
      setDisabledAt(null)
      toast.success(tx("Account reactivated"))
      await router.invalidate()
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't reactivate account")))
    } finally {
      setPendingAction(null)
    }
  }

  async function onDelete() {
    if (pending) return
    setPendingAction("delete")
    try {
      const { error } = await authClient.deleteUser()
      if (error) {
        toast.error(errorMessage(error, tx("Couldn't delete account")))
        return
      }
      toast.success(tx("Account deleted"))
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Something went wrong")))
    } finally {
      setPendingAction(null)
    }
  }

  return {
    disabledAt,
    pending,
    pendingAction,
    onDisable,
    onReactivate,
    onDelete,
  }
}

function DisableAccountRow({
  disabledAt,
  pending,
  pendingAction,
  onDisable,
  onReactivate,
}: {
  disabledAt: string | null
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  onDisable: () => Promise<void>
  onReactivate: () => Promise<void>
}) {
  return (
    <SettingRow
      className="py-4 first:pt-4 last:pb-4"
      title={disabledAt ? tx("Reactivate account") : tx("Disable account")}
      description={
        disabledAt
          ? tx("Make your profile and clips visible again.")
          : tx("Hide your profile and clips until you reactivate your account.")
      }
    >
      {disabledAt ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReactivate}
          disabled={pending}
        >
          <RotateCcwIcon />
          {pendingAction === "reactivate"
            ? tx("Reactivating...")
            : tx("Reactivate")}
        </Button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="outline" size="sm">
                <EyeOffIcon />
                {tx("Disable")}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tx("Disable your account?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tx(
                  "Your profile and clips will be hidden until you sign back in and reactivate.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                {tx("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={onDisable} disabled={pending}>
                {pendingAction === "disable"
                  ? tx("Disabling...")
                  : tx("Disable account")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </SettingRow>
  )
}

function DeleteAccountRow({
  pending,
  pendingAction,
  onDelete,
}: {
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  onDelete: () => Promise<void>
}) {
  return (
    <SettingRow
      className="py-4 first:pt-4 last:pb-4"
      title={tx("Delete account")}
      description={tx(
        "Permanently removes your account and clips. Can't be undone.",
      )}
    >
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="danger" size="sm">
              <Trash2Icon />
              {tx("Delete account")}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tx("Delete your account?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tx("This can't be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {tx("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              {pendingAction === "delete"
                ? tx("Deleting...")
                : tx("Delete account")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  )
}

export function DangerZoneCard() {
  const actions = useAccountDangerActions()

  return (
    <Section>
      <SectionContent className="py-0">
        <DisableAccountRow {...actions} />
        <DeleteAccountRow {...actions} />
      </SectionContent>
    </Section>
  )
}
