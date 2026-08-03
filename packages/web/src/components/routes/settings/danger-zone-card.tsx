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
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
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
  const [actionError, setActionError] = useState<string | null>(null)
  // The session user already carries `disabledAt`, so seed from it rather than
  // an isolated fetch that flashes a loading row each time the card mounts. The
  // handlers below keep it current after a disable/reactivate.
  const [disabledAt, setDisabledAt] = useState<string | null>(
    session?.user.disabledAt ?? null,
  )

  const pending = pendingAction !== null

  async function onDisable() {
    if (pending) return
    setActionError(null)
    setPendingAction("disable")
    try {
      const state = await api.users.disableAccount()
      setDisabledAt(state.disabledAt)
      try {
        await signOut()
      } catch (cause) {
        clientLogger.warn("[account] Failed to sign out after disable.", cause)
      }
      resetClientState()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      setActionError(errorMessage(cause, t("Couldn't disable account")))
    } finally {
      setPendingAction(null)
    }
  }

  async function onReactivate() {
    if (pending) return
    setActionError(null)
    setPendingAction("reactivate")
    try {
      await api.users.reactivateAccount()
      setDisabledAt(null)
      await router.invalidate()
    } catch (cause) {
      setActionError(errorMessage(cause, t("Couldn't reactivate account")))
    } finally {
      setPendingAction(null)
    }
  }

  async function onDelete() {
    if (pending) return
    setActionError(null)
    setPendingAction("delete")
    try {
      const { error } = await authClient.deleteUser()
      if (error) {
        setActionError(errorMessage(error, t("Couldn't delete account")))
        return
      }
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      setActionError(errorMessage(cause, t("Something went wrong")))
    } finally {
      setPendingAction(null)
    }
  }

  return {
    disabledAt,
    pending,
    pendingAction,
    actionError,
    clearActionError: () => setActionError(null),
    onDisable,
    onReactivate,
    onDelete,
  }
}

function DisableAccountRow({
  disabledAt,
  pending,
  pendingAction,
  actionError,
  onDisable,
  onReactivate,
}: {
  disabledAt: string | null
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  actionError: string | null
  onDisable: () => Promise<void>
  onReactivate: () => Promise<void>
}) {
  return (
    <SettingRow
      title={disabledAt ? t("Reactivate account") : t("Disable account")}
      description={
        disabledAt
          ? t("Make your profile and clips visible again.")
          : t("Hide your profile and clips until you reactivate your account.")
      }
    >
      {disabledAt ? (
        <div className="flex flex-col items-end gap-1.5">
          <FeedbackButton
            type="button"
            variant="outline"
            size="sm"
            onClick={onReactivate}
            disabled={pending}
            state={
              pendingAction === "reactivate"
                ? "pending"
                : actionError
                  ? "error"
                  : "idle"
            }
            pendingLabel={t("Reactivating...")}
            errorLabel={t("Try again")}
          >
            <RotateCcwIcon />
            {t("Reactivate")}
          </FeedbackButton>
          {actionError ? (
            <span role="alert" className="text-destructive text-xs">
              {actionError}
            </span>
          ) : null}
        </div>
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
            {actionError ? (
              <p role="alert" className="text-destructive text-sm">
                {actionError}
              </p>
            ) : null}
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
  actionError,
  clearActionError,
  onDelete,
}: {
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  actionError: string | null
  clearActionError: () => void
  onDelete: () => Promise<void>
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <SettingRow
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
          onOpenChange={(open) => {
            setDeleteOpen(open)
            if (!open) clearActionError()
          }}
          title={t("Delete your account?")}
          description={t("This can't be undone.")}
          confirmLabel={t("Delete account")}
          pendingLabel={
            pendingAction === "delete" ? t("Deleting...") : t("Delete account")
          }
          pending={pending}
          error={actionError}
          onConfirm={onDelete}
        />
      </>
    </SettingRow>
  )
}

export function DangerZoneCard() {
  const actions = useAccountDangerActions()

  return (
    <SettingRows>
      <DisableAccountRow {...actions} />
      <DeleteAccountRow {...actions} />
    </SettingRows>
  )
}
