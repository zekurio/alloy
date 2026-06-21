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
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { List, ListItem } from "@alloy/ui/components/list"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { toast } from "@alloy/ui/lib/toast"
import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent } from "react"

import { LimitedInput } from "@/components/form/limited-field"
import { authClient } from "@/lib/auth-client"
import { toastAuthAttemptFailure } from "@/lib/auth-flow"
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

  async function onDelete(passkey: Passkey) {
    if (deletingId) return
    setDeletingId(passkey.id)
    try {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      })
      if (error) {
        toast.error(errorMessage(error, t("Couldn't remove passkey")))
        return
      }
      toast.success(t("Passkey removed"))
      await onRefresh()
    } catch (cause) {
      toast.error(errorMessage(cause, t("Something went wrong")))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Section>
      <SectionContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("Passkeys")}</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {t(
                "Sign in without a password using your device or hardware key.",
              )}
            </p>
          </div>
          <AddPasskeyDialog onAdded={onRefresh} />
        </div>

        {passkeys.length > 0 ? (
          <List>
            {passkeys.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                removing={deletingId === passkey.id}
                onDelete={() => onDelete(passkey)}
                onRefresh={onRefresh}
              />
            ))}
          </List>
        ) : (
          <p className="text-foreground-muted text-sm">
            {t("No passkeys yet. Add one for faster, password-free sign-in.")}
          </p>
        )}
      </SectionContent>
    </Section>
  )
}

function AddPasskeyDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (adding) return
    setAdding(true)
    try {
      const { error } = await addPasskeyWithLabel({
        label: name,
      })
      if (error) {
        toastAuthAttemptFailure(
          "passkey registration",
          "Couldn't register passkey",
          error,
        )
        return
      }
      toast.success(t("Passkey added"))
      setOpen(false)
      setName("")
      await onAdded()
    } catch (cause) {
      toastAuthAttemptFailure(
        "passkey registration",
        "Passkey registration failed",
        cause,
      )
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <PlusIcon />
            {t("Add passkey")}
          </Button>
        }
      />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("Add a passkey")}</DialogTitle>
            <DialogDescription>
              {t(
                "Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="passkey-name">
                {t("Name (optional)")}
              </FieldLabel>
              <LimitedInput
                id="passkey-name"
                type="text"
                value={name}
                maxLength={64}
                placeholder={t("e.g. Laptop, YubiKey")}
                onChange={(e) => setName(e.target.value)}
                disabled={adding}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={adding}
              onClick={() => setOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={adding}>
              {adding ? t("Waiting for authenticator…") : t("Register")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PasskeyRow({
  passkey,
  removing,
  onDelete,
  onRefresh,
}: {
  passkey: Passkey
  removing: boolean
  onDelete: () => void
  onRefresh: () => Promise<void>
}) {
  return (
    <ListItem>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {passkey.name || "Passkey"}
        </div>
        <p className="text-foreground-dim truncate text-xs">
          {t("Added")}
          {formatCalendarDate(passkey.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <EditPasskeyDialog passkey={passkey} onUpdated={onRefresh} />
        <AlertDialog>
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
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={onDelete}
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
    setSaving(true)
    try {
      const { error } = await authClient.passkey.updatePasskey({
        id: passkey.id,
        name: name.trim() || undefined,
      })
      if (error) {
        toast.error(errorMessage(error, t("Couldn't rename passkey")))
        return
      }
      toast.success(t("Passkey renamed"))
      setOpen(false)
      await onUpdated()
    } catch (cause) {
      toast.error(errorMessage(cause, t("Something went wrong")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Rename passkey")}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("Rename passkey")}</DialogTitle>
            <DialogDescription>
              {t("Give this passkey a name so you can recognise it later.")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor={`passkey-name-${passkey.id}`}>
                {t("Name")}
              </FieldLabel>
              <LimitedInput
                id={`passkey-name-${passkey.id}`}
                type="text"
                value={name}
                maxLength={64}
                placeholder={t("e.g. Laptop, YubiKey")}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving || !dirty}
            >
              <SaveIcon />
              {saving ? t("Saving…") : t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
