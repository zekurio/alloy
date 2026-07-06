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
  AlertDialogTrigger,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { EyeOffIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

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
  const [pendingAction, setPendingAction] = useState<
    "disable" | "reactivate" | "delete" | null
  >(null)
  // The session user already carries `disabledAt`, so seed from it rather than
  // an isolated fetch that flashes a loading row each time the card mounts. The
  // handlers below keep it current after a disable/reactivate.
  const [disabledAt, setDisabledAt] = useState<string | null>(
    session?.user.disabledAt ?? null,
  )

  const pending = pendingAction !== null

  async function onDisable() {
    if (pending) return
    setPendingAction("disable")
    try {
      const state = await api.users.disableAccount()
      setDisabledAt(state.disabledAt)
      toast.success(t("Account disabled"))
      try {
        await signOut()
      } catch (cause) {
        clientLogger.warn("[account] Failed to sign out after disable.", cause)
      }
      resetClientState()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't disable account")))
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
      toast.success(t("Account reactivated"))
      await router.invalidate()
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't reactivate account")))
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
        toast.error(errorMessage(error, t("Couldn't delete account")))
        return
      }
      toast.success(t("Account deleted"))
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, t("Something went wrong")))
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
      title={disabledAt ? t("Reactivate account") : t("Disable account")}
      description={
        disabledAt
          ? t("Make your profile and clips visible again.")
          : t("Hide your profile and clips until you reactivate your account.")
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
            ? t("Reactivating...")
            : t("Reactivate")}
        </Button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="outline" size="sm">
                <EyeOffIcon />
                {t("Disable")}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Disable your account?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "Your profile and clips will be hidden until you sign back in and reactivate.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={onDisable} disabled={pending}>
                {pendingAction === "disable"
                  ? t("Disabling...")
                  : t("Disable account")}
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
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <SettingRow
      className="py-4 first:pt-4 last:pb-4"
      title={t("Delete account")}
      description={t(
        "Permanently removes your account and clips. Can't be undone.",
      )}
    >
      <>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2Icon />
          {t("Delete account")}
        </Button>
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t("Delete your account?")}
          description={t("This can't be undone.")}
          confirmLabel={t("Delete account")}
          pendingLabel={
            pendingAction === "delete" ? t("Deleting...") : t("Delete account")
          }
          pending={pending}
          onConfirm={onDelete}
        />
      </>
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
