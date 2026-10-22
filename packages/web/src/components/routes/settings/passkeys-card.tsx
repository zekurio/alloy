import type { Passkey } from "@alloy/api/auth"
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
import { Callout } from "@alloy/ui/components/callout"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@alloy/ui/components/dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { List, ListItem } from "@alloy/ui/components/list"
import { useQueryClient } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { LimitedInput } from "@/components/form/limited-field"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient } from "@/lib/auth-client"
import {
  isAuthAttemptCancellation,
  reportAuthFlowFailure,
} from "@/lib/auth-flow"
import { authKeys } from "@/lib/auth-query-keys"
import { formatCalendarDate } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { addPasskeyWithLabel } from "@/lib/passkeys"
import { refreshAfterWrite } from "@/lib/refresh-after-write"

export type { Passkey }

type ApplyPasskeyWrite = (update: (passkeys: Passkey[]) => Passkey[]) => void

/**
 * Applies a successful passkey write to the cached list, then refetches in
 * the background so a failed refetch can't report the write as failed.
 */
function useApplyPasskeyWrite(
  onRefresh: () => Promise<void>,
): ApplyPasskeyWrite {
  const queryClient = useQueryClient()
  return (update) => {
    queryClient.setQueryData<Passkey[]>(authKeys.passkeys(), (current) =>
      current ? update(current) : current,
    )
    void refreshAfterWrite("passkeys", onRefresh)
  }
}

export function PasskeysCard({
  passkeys,
  onRefresh,
}: {
  passkeys: Passkey[]
  onRefresh: () => Promise<void>
}) {
  const applyWrite = useApplyPasskeyWrite(onRefresh)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{
    id: string
    message: string
  } | null>(null)

  async function onDelete(passkey: Passkey) {
    if (deletingId) return
    setDeleteError(null)
    setDeletingId(passkey.id)
    try {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      })
      if (error) {
        setDeleteError({
          id: passkey.id,
          message: errorMessage(error, t("Couldn't remove passkey")),
        })
        return
      }
      applyWrite((current) =>
        current.filter((entry) => entry.id !== passkey.id),
      )
    } catch (cause) {
      setDeleteError({
        id: passkey.id,
        message: errorMessage(cause, t("Something went wrong")),
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <SettingsSubsection
      id="passkeys"
      title={t("Passkeys")}
      description={t(
        "Sign in without a password using your device or hardware key.",
      )}
      action={<AddPasskeyDialog applyWrite={applyWrite} />}
    >
      {passkeys.length > 0 ? (
        <List>
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              removing={deletingId === passkey.id}
              removeError={
                deleteError?.id === passkey.id ? deleteError.message : null
              }
              onDelete={() => onDelete(passkey)}
              onDismissRemoveError={() => setDeleteError(null)}
              applyWrite={applyWrite}
            />
          ))}
        </List>
      ) : (
        <p className="text-foreground-dim text-xs">
          {t("No passkeys yet. Add one for faster, password-free sign-in.")}
        </p>
      )}
    </SettingsSubsection>
  )
}

function AddPasskeyDialog({ applyWrite }: { applyWrite: ApplyPasskeyWrite }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setSubmitError(null)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (adding) return
    setSubmitError(null)
    setAdding(true)
    try {
      const { data, error } = await addPasskeyWithLabel({
        label: name,
      })
      if (error) {
        reportAuthFlowFailure(
          "passkey registration",
          t("Couldn't register passkey"),
          error,
        )
        setSubmitError(
          isAuthAttemptCancellation(error)
            ? t("Auth attempt cancelled.")
            : errorMessage(error, t("Couldn't register passkey")),
        )
        return
      }
      handleOpenChange(false)
      setName("")
      applyWrite((current) => (data ? [...current, data] : current))
    } catch (cause) {
      reportAuthFlowFailure(
        "passkey registration",
        t("Passkey registration failed"),
        cause,
      )
      setSubmitError(
        isAuthAttemptCancellation(cause)
          ? t("Auth attempt cancelled.")
          : errorMessage(cause, t("Passkey registration failed")),
      )
    } finally {
      setAdding(false)
    }
  }

  return (
    <PasskeyNameDialog
      mode="add"
      open={open}
      name={name}
      error={submitError}
      busy={adding}
      onOpenChange={handleOpenChange}
      onNameChange={setName}
      onSubmit={onSubmit}
      submitAction={
        <FeedbackButton
          type="submit"
          variant="primary"
          size="sm"
          state={adding ? "pending" : submitError ? "error" : "idle"}
          pendingLabel={t("Waiting for authenticator…")}
          errorLabel={t("Try again")}
        >
          {t("Register")}
        </FeedbackButton>
      }
    />
  )
}

/** Shared add/rename dialog chrome and name field. */
function PasskeyNameDialog({
  mode,
  passkeyId,
  open,
  busy,
  name,
  error,
  onOpenChange,
  onNameChange,
  onSubmit,
  submitAction,
}: {
  mode: "add" | "edit"
  passkeyId?: string
  open: boolean
  busy: boolean
  name: string
  error: string | null
  onOpenChange: (open: boolean) => void
  onNameChange: (name: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitAction: ReactNode
}) {
  const isAdd = mode === "add"
  const fieldId = isAdd ? "passkey-name" : `passkey-name-${passkeyId}`
  const trigger = isAdd ? (
    <Button type="button">
      <PlusIcon />
      {t("Add passkey")}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("Rename passkey")}
    >
      <PencilIcon className="size-3.5" />
    </Button>
  )
  const title = isAdd ? t("Add a passkey") : t("Rename passkey")
  const description = isAdd
    ? t(
        "Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key.",
      )
    : t("Give this passkey a name so you can recognise it later.")
  const fieldLabel = isAdd ? t("Name (optional)") : t("Name")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor={fieldId}>{fieldLabel}</FieldLabel>
              <LimitedInput
                id={fieldId}
                type="text"
                value={name}
                maxLength={64}
                placeholder={t("e.g. Laptop, YubiKey")}
                onChange={(e) => onNameChange(e.target.value)}
                disabled={busy}
              />
            </Field>
            {error ? (
              <Callout tone="destructive" className="mt-3 text-xs">
                <CircleAlertIcon />
                <span>{error}</span>
              </Callout>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            {submitAction}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PasskeyRow({
  passkey,
  removing,
  removeError,
  onDelete,
  onDismissRemoveError,
  applyWrite,
}: {
  passkey: Passkey
  removing: boolean
  removeError: string | null
  onDelete: () => void
  onDismissRemoveError: () => void
  applyWrite: ApplyPasskeyWrite
}) {
  return (
    <ListItem>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {passkey.name || "Passkey"}
        </div>
        <p className="text-foreground-dim truncate text-xs">
          {t("Added")} {formatCalendarDate(passkey.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <EditPasskeyDialog passkey={passkey} applyWrite={applyWrite} />
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) onDismissRemoveError()
          }}
        >
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Remove passkey")}
                disabled={removing}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Remove this passkey?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "You may need another sign-in method to access your account.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {removeError ? (
              <Callout tone="destructive">
                <CircleAlertIcon />
                <span>{removeError}</span>
              </Callout>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(event) => {
                  event.preventDefault()
                  onDelete()
                }}
                disabled={removing}
              >
                {removing ? t("Removing…") : t("Remove passkey")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ListItem>
  )
}

function EditPasskeyDialog({
  passkey,
  applyWrite,
}: {
  passkey: Passkey
  applyWrite: ApplyPasskeyWrite
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(passkey.name ?? "")
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const currentName = passkey.name ?? ""
  const dirty = name.trim() !== currentName

  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setSubmitError(null)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    if (!dirty) {
      handleOpenChange(false)
      return
    }
    setSubmitError(null)
    setSaving(true)
    try {
      const { data, error } = await authClient.passkey.updatePasskey({
        id: passkey.id,
        name: name.trim() || undefined,
      })
      if (error) {
        setSubmitError(errorMessage(error, t("Couldn't rename passkey")))
        return
      }
      handleOpenChange(false)
      applyWrite((current) =>
        data
          ? current.map((entry) => (entry.id === data.id ? data : entry))
          : current,
      )
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Something went wrong")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PasskeyNameDialog
      mode="edit"
      passkeyId={passkey.id}
      open={open}
      name={name}
      error={submitError}
      busy={saving}
      onOpenChange={handleOpenChange}
      onNameChange={setName}
      onSubmit={onSubmit}
      submitAction={
        <FeedbackButton
          type="submit"
          variant="primary"
          size="sm"
          disabled={saving || !dirty}
          state={saving ? "pending" : submitError ? "error" : "idle"}
          pendingLabel={t("Saving…")}
          errorLabel={t("Try again")}
        >
          <SaveIcon />
          {t("Save")}
        </FeedbackButton>
      }
    />
  )
}
