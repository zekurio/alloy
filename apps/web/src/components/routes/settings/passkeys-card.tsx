import * as React from "react"
import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { List, ListItem } from "@workspace/ui/components/list"
import { Section, SectionContent } from "@workspace/ui/components/section"
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
} from "@workspace/ui/components/alert-dialog"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { toast } from "@workspace/ui/lib/toast"

import type { Passkey as ApiPasskey } from "@workspace/api/auth"

import { LimitedInput } from "@/components/form/limited-field"
import { authClient } from "@/lib/auth-client"
import { reportAuthFlowFailure } from "@/lib/auth-flow"
import { formatCalendarDate } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { addPasskeyWithLabel } from "@/lib/passkeys"

export type Passkey = ApiPasskey

export function PasskeysCard({
  passkeys,
  onRefresh,
}: {
  passkeys: Passkey[]
  onRefresh: () => Promise<void>
}) {
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  async function onDelete(passkey: Passkey) {
    if (deletingId) return
    setDeletingId(passkey.id)
    try {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      })
      if (error) {
        toast.error(errorMessage(error, "Couldn't remove passkey"))
        return
      }
      toast.success("Passkey removed")
      await onRefresh()
    } catch (cause) {
      toast.error(errorMessage(cause, "Something went wrong"))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Section>
      <SectionContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Passkeys</div>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Sign in without a password using your device or hardware key.
            </p>
          </div>
          <AddPasskeyDialog onAdded={onRefresh} />
        </div>

        {passkeys.length > 0
          ? (
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
          )
          : (
            <p className="text-sm text-foreground-muted">
              No passkeys yet. Add one for faster, password-free sign-in.
            </p>
          )}
      </SectionContent>
    </Section>
  )
}

function AddPasskeyDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [adding, setAdding] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (adding) return
    setAdding(true)
    try {
      const { error } = await addPasskeyWithLabel({
        label: name,
      })
      if (error) {
        toast.error(errorMessage(error, "Couldn't register passkey"))
        return
      }
      toast.success("Passkey added")
      setOpen(false)
      setName("")
      await onAdded()
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure(
          "passkey registration",
          "Passkey registration failed",
          cause,
        ),
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
            Add passkey
          </Button>
        }
      />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add a passkey</DialogTitle>
            <DialogDescription>
              Your browser will prompt you to use Touch ID, Face ID, Windows
              Hello, or a security key.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="passkey-name">Name (optional)</FieldLabel>
              <LimitedInput
                id="passkey-name"
                type="text"
                value={name}
                maxLength={64}
                placeholder="e.g. Laptop, YubiKey"
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
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={adding}>
              {adding ? "Waiting for authenticator…" : "Register"}
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
        <p className="truncate text-xs text-foreground-dim">
          Added {formatCalendarDate(passkey.createdAt)}
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
                aria-label="Remove passkey"
                disabled={removing}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this passkey?</AlertDialogTitle>
              <AlertDialogDescription>
                You may need another sign-in method to access your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={onDelete}
                disabled={removing}
              >
                {removing ? "Removing…" : "Remove passkey"}
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
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(passkey.name ?? "")
  const [saving, setSaving] = React.useState(false)
  const currentName = passkey.name ?? ""
  const dirty = name.trim() !== currentName

  React.useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
        toast.error(errorMessage(error, "Couldn't rename passkey"))
        return
      }
      toast.success("Passkey renamed")
      setOpen(false)
      await onUpdated()
    } catch (cause) {
      toast.error(errorMessage(cause, "Something went wrong"))
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
            aria-label="Rename passkey"
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
            <DialogDescription>
              Give this passkey a name so you can recognise it later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor={`passkey-name-${passkey.id}`}>
                Name
              </FieldLabel>
              <LimitedInput
                id={`passkey-name-${passkey.id}`}
                type="text"
                value={name}
                maxLength={64}
                placeholder="e.g. Laptop, YubiKey"
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
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving || !dirty}
            >
              <SaveIcon />
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
