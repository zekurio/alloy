import type { NewRecoveryKey } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { FieldError } from "@alloy/ui/components/field"
import { List, ListItem } from "@alloy/ui/components/list"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeySquareIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { RecoveryKeyDisplay } from "@/components/auth/recovery-key-display"
import { LoadErrorCallout } from "@/components/routes/load-error"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient } from "@/lib/auth-client"
import { authKeys, recoveryKeyStatusQueryOptions } from "@/lib/auth-query-keys"
import { formatCalendarDate } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseSession } from "@/lib/session-suspense"

/**
 * Whether the account has a recovery key, and a way to make one. Loads on
 * its own, so a failure here leaves the other security settings in place.
 */
export function RecoveryKeyCard() {
  const session = useSuspenseSession()
  const queryClient = useQueryClient()
  const status = useQuery(recoveryKeyStatusQueryOptions())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [shown, setShown] = useState<NewRecoveryKey | null>(null)
  // Lives outside the dialogs, so closing one mid-request still shows the
  // key that request made.
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.recoveryKey.create()
      if (error || !data) {
        throw new Error(
          errorMessage(error, t("Could not create a recovery key")),
        )
      }
      return data
    },
    onSuccess: (data) => {
      setConfirmOpen(false)
      setShown(data)
      queryClient.setQueryData(authKeys.recoveryKey(), {
        createdAt: data.createdAt,
      })
    },
  })

  if (status.isPending) return null

  const createdAt = status.data?.createdAt ?? null
  const createError = create.error && !confirmOpen ? create.error.message : null

  const action = !status.data ? null : createdAt === null ? (
    <FeedbackButton
      type="button"
      variant="secondary"
      state={create.isPending ? "pending" : create.isError ? "error" : "idle"}
      pendingLabel={t("Creating…")}
      errorLabel={t("Try again")}
      disabled={create.isPending}
      onClick={() => create.mutate()}
    >
      <KeySquareIcon />
      {t("Create recovery key")}
    </FeedbackButton>
  ) : (
    <Button
      type="button"
      variant="secondary"
      disabled={create.isPending}
      onClick={() => {
        create.reset()
        setConfirmOpen(true)
      }}
    >
      <RefreshCwIcon />
      {t("Replace recovery key")}
    </Button>
  )

  return (
    <SettingsSubsection
      id="recovery-key"
      title={t("Recovery key")}
      description={t(
        "A secret, shown once, that gets you back in if you lose every passkey.",
      )}
      action={action}
    >
      {!status.data ? (
        <LoadErrorCallout
          message={errorMessage(
            status.error,
            t("Could not load the recovery key"),
          )}
          onRetry={() => void status.refetch()}
        />
      ) : createdAt !== null ? (
        <List>
          <ListItem>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {t("Recovery key")}
              </div>
              <p className="text-foreground-dim truncate text-xs">
                {t("Created {date}", { date: formatCalendarDate(createdAt) })}
              </p>
            </div>
          </ListItem>
        </List>
      ) : (
        <p className="text-foreground-dim text-xs">
          {t(
            "No recovery key yet. Make one so you can get back in if you lose every passkey.",
          )}
        </p>
      )}
      <FieldError>{createError}</FieldError>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !create.isPending) setConfirmOpen(false)
        }}
        title={t("Replace your recovery key?")}
        description={t(
          "Your current recovery key stops working as soon as the new one is made.",
        )}
        confirmLabel={t("Replace recovery key")}
        pendingLabel={t("Creating…")}
        pending={create.isPending}
        error={confirmOpen ? create.error?.message : undefined}
        confirmVariant="destructive"
        onConfirm={() => {
          if (!create.isPending) create.mutate()
        }}
      />

      <AlertDialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (open) return
          setShown(null)
          create.reset()
        }}
      >
        {shown ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Your new recovery key")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "Keep it somewhere safe, like a password manager or a printout.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <RecoveryKeyDisplay
              recoveryKey={shown}
              username={session?.user.username ?? ""}
            />
            <AlertDialogFooter>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setShown(null)
                  create.reset()
                }}
              >
                {t("I've saved it")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </SettingsSubsection>
  )
}
