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
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"

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

/** Maps a failed registration to the message the dialog shows. */
function registrationError(cause: unknown, fallback: string): Error {
  reportAuthFlowFailure("passkey registration", fallback, cause)
  return new Error(
    isAuthAttemptCancellation(cause)
      ? t("Auth attempt cancelled.")
      : errorMessage(cause, fallback),
  )
}

function AddPasskeyDialog({ applyWrite }: { applyWrite: ApplyPasskeyWrite }) {
  const [open, setOpen] = useState(false)
  // The typed name survives a cancel and clears once a passkey is added.
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: ({ value }) => {
      if (!register.isPending) register.mutate(value.name)
    },
  })
  const name = useStore(form.store, (state) => state.values.name)
  // Lives outside the dialog content, so closing mid-registration still
  // records the new passkey.
  const register = useMutation({
    mutationFn: async (label: string) => {
      const result = await addPasskeyWithLabel({ label }).catch(
        (cause: unknown) => {
          throw registrationError(cause, t("Passkey registration failed"))
        },
      )
      if (result.error) {
        throw registrationError(result.error, t("Couldn't register passkey"))
      }
      return result.data
    },
    onSuccess: (data) => {
      setOpen(false)
      form.reset()
      applyWrite((current) => (data ? [...current, data] : current))
    },
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Resetting an in-flight registration would drop its pending state.
    if (!next && !register.isPending) register.reset()
  }

  return (
    <PasskeyNameDialog
      mode="add"
      open={open}
      name={name}
      error={register.error?.message ?? null}
      busy={register.isPending}
      onOpenChange={handleOpenChange}
      onNameChange={(next) => form.setFieldValue("name", next)}
      onSubmit={() => void form.handleSubmit()}
      submitAction={
        <FeedbackButton
          type="submit"
          variant="primary"
          size="sm"
          state={
            register.isPending ? "pending" : register.isError ? "error" : "idle"
          }
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
  onSubmit: () => void
  submitAction: ReactNode
}) {
  const isAdd = mode === "add"
  const fieldId = isAdd ? "passkey-name" : `passkey-name-${passkeyId}`
  const trigger = isAdd ? (
    <Button type="button" variant="secondary">
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
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSubmit()
          }}
        >
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
  applyWrite,
}: {
  passkey: Passkey
  applyWrite: ApplyPasskeyWrite
}) {
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      })
      if (error) {
        throw new Error(errorMessage(error, t("Couldn't remove passkey")))
      }
    },
    onSuccess: () =>
      applyWrite((current) =>
        current.filter((entry) => entry.id !== passkey.id),
      ),
  })
  const removing = remove.isPending
  const removeError = remove.error
    ? errorMessage(remove.error, t("Something went wrong"))
    : null

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
            if (!open && !remove.isPending) remove.reset()
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
                  if (!removing) remove.mutate()
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
  const currentName = passkey.name ?? ""
  const form = useForm({
    defaultValues: { name: currentName },
    onSubmit: ({ value }) => {
      if (rename.isPending) return
      if (value.name.trim() === currentName) {
        handleOpenChange(false)
        return
      }
      rename.mutate(value.name.trim())
    },
  })
  const name = useStore(form.store, (state) => state.values.name)
  const dirty = name.trim() !== currentName
  const rename = useMutation({
    mutationFn: async (nextName: string) => {
      const { data, error } = await authClient.passkey.updatePasskey({
        id: passkey.id,
        name: nextName || undefined,
      })
      if (error) {
        throw new Error(errorMessage(error, t("Couldn't rename passkey")))
      }
      return data
    },
    onSuccess: (data) => {
      setOpen(false)
      applyWrite((current) =>
        data
          ? current.map((entry) => (entry.id === data.id ? data : entry))
          : current,
      )
    },
  })
  const submitError = rename.error
    ? errorMessage(rename.error, t("Something went wrong"))
    : null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Every opening starts from the passkey's current name.
    if (next) form.reset()
    else if (!rename.isPending) rename.reset()
  }

  return (
    <PasskeyNameDialog
      mode="edit"
      passkeyId={passkey.id}
      open={open}
      name={name}
      error={submitError}
      busy={rename.isPending}
      onOpenChange={handleOpenChange}
      onNameChange={(next) => form.setFieldValue("name", next)}
      onSubmit={() => void form.handleSubmit()}
      submitAction={
        <FeedbackButton
          type="submit"
          variant="primary"
          size="sm"
          disabled={rename.isPending || !dirty}
          state={rename.isPending ? "pending" : submitError ? "error" : "idle"}
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
