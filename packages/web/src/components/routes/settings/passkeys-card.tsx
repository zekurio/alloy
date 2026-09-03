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
import {
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent, ReactElement, ReactNode } from "react"

import { LimitedInput } from "@/components/form/limited-field"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient } from "@/lib/auth-client"
import {
  isAuthAttemptCancellation,
  reportAuthFlowFailure,
} from "@/lib/auth-flow"
import { formatCalendarDate } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { addPasskeyWithLabel } from "@/lib/passkeys"

export type { Passkey }

export function PasskeysCard({
  passkeys,
  onRefresh,
}: {
  passkeys: Passkey[]
  onRefresh: () => Promise<void>
}) {
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
      await onRefresh()
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
      action={<AddPasskeyDialog onAdded={onRefresh} />}
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
              onRefresh={onRefresh}
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

function AddPasskeyDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (adding) return
    setSubmitError(null)
    setAdding(true)
    try {
      const { error } = await addPasskeyWithLabel({
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
      setOpen(false)
      setName("")
      await onAdded()
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
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSubmitError(null)
      }}
      trigger={
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("Add passkey")}
        >
          <PlusIcon />
        </Button>
      }
      title={t("Add a passkey")}
      description={t(
        "Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key.",
      )}
      fieldId="passkey-name"
      fieldLabel={t("Name (optional)")}
      name={name}
      onNameChange={setName}
      busy={adding}
      error={submitError}
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

/**
 * Shared scaffolding for the add/rename passkey dialogs: an icon-button
 * trigger opening a name form with the cancel action wired to close.
 */
function PasskeyNameDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  fieldId,
  fieldLabel,
  name,
  onNameChange,
  busy,
  error,
  onSubmit,
  submitAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement
  title: string
  description: string
  fieldId: string
  fieldLabel: string
  name: string
  onNameChange: (name: string) => void
  busy: boolean
  error: string | null
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitAction: ReactNode
}) {
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
  onRefresh,
}: {
  passkey: Passkey
  removing: boolean
  removeError: string | null
  onDelete: () => void
  onDismissRemoveError: () => void
  onRefresh: () => Promise<void>
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
        <EditPasskeyDialog passkey={passkey} onUpdated={onRefresh} />
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
  onUpdated,
}: {
  passkey: Passkey
  onUpdated: () => Promise<void>
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    if (!dirty) {
      setOpen(false)
      return
    }
    setSubmitError(null)
    setSaving(true)
    try {
      const { error } = await authClient.passkey.updatePasskey({
        id: passkey.id,
        name: name.trim() || undefined,
      })
      if (error) {
        setSubmitError(errorMessage(error, t("Couldn't rename passkey")))
        return
      }
      setOpen(false)
      await onUpdated()
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Something went wrong")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PasskeyNameDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSubmitError(null)
      }}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Rename passkey")}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      }
      title={t("Rename passkey")}
      description={t("Give this passkey a name so you can recognise it later.")}
      fieldId={`passkey-name-${passkey.id}`}
      fieldLabel={t("Name")}
      name={name}
      onNameChange={setName}
      busy={saving}
      error={submitError}
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
