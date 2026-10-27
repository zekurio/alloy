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
import { useMutation } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { EyeOffIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { completeAccountExitFlow } from "@/lib/auth-flow"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseSession } from "@/lib/session-suspense"

type DangerAction = "disable" | "reactivate" | "delete"

function useAccountDangerActions() {
  const router = useRouter()
  const navigate = useNavigate()
  const session = useSuspenseSession()
  // The session user already carries `disabledAt`, so seed from it rather than
  // an isolated fetch that flashes a loading row each time the card mounts. The
  // actions below keep it current after a disable/reactivate.
  const [disabledAt, setDisabledAt] = useState<string | null>(
    session?.user.disabledAt ?? null,
  )

  async function disable() {
    const state = await api.users.disableAccount()
    setDisabledAt(state.disabledAt)
    await completeAccountExitFlow({
      invalidateRouter: () => router.invalidate(),
      navigate: () => navigate({ to: "/login" }),
    })
  }

  async function reactivate() {
    await api.users.reactivateAccount()
    setDisabledAt(null)
    await router.invalidate()
  }

  async function deleteAccount() {
    const { error } = await authClient.deleteUser()
    if (error)
      throw new Error(errorMessage(error, t("Couldn't delete account")))
    await completeAccountExitFlow({
      invalidateRouter: () => router.invalidate(),
      navigate: () => navigate({ to: "/login" }),
    })
  }

  // One mutation for every action, so they share one in-flight lock and the
  // latest failure.
  const mutation = useMutation({
    mutationFn: async (action: DangerAction) => {
      const [run, fallback] =
        action === "disable"
          ? [disable, t("Couldn't disable account")]
          : action === "reactivate"
            ? [reactivate, t("Couldn't reactivate account")]
            : [deleteAccount, t("Something went wrong")]
      try {
        await run()
      } catch (cause) {
        throw new Error(errorMessage(cause, fallback))
      }
    },
  })

  const pending = mutation.isPending
  const start = async (action: DangerAction) => {
    if (pending) return
    await mutation.mutateAsync(action).catch(() => undefined)
  }

  return {
    disabledAt,
    pending,
    pendingAction: pending ? mutation.variables : null,
    actionError: mutation.error?.message ?? null,
    clearActionError: mutation.reset,
    onDisable: () => start("disable"),
    onReactivate: () => start("reactivate"),
    onDelete: () => start("delete"),
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
  pendingAction: DangerAction | null
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
            variant="secondary"
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
              <Button type="button" variant="secondary" size="sm">
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
  pendingAction: DangerAction | null
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
