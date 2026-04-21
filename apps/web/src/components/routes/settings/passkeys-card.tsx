import * as React from "react"
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
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
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"

type Passkey = {
  id: string
  name?: string | null
  createdAt: string | Date
  deviceType?: string
}

function usePasskeys() {
  const [passkeys, setPasskeys] = React.useState<Passkey[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys()
    if (error) {
      toast.error(error.message ?? "Couldn't load passkeys")
      setPasskeys([])
      return
    }
    setPasskeys((data ?? []) as Passkey[])
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  return { passkeys, loading, refresh }
}

export function PasskeysCard() {
  const { passkeys, loading, refresh } = usePasskeys()
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  async function onDelete(passkey: Passkey) {
    if (deletingId) return
    setDeletingId(passkey.id)
    try {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      })
      if (error) {
        toast.error(error.message ?? "Couldn't remove passkey")
        return
      }
      toast.success("Passkey removed")
      await refresh()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong"
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Passkeys</div>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Sign in without a password using your device or hardware key.
            </p>
          </div>
          <AddPasskeyDialog onAdded={refresh} />
        </div>

        {loading ? (
          <p className="text-sm text-foreground-muted">Loading…</p>
        ) : passkeys && passkeys.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {passkeys.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                removing={deletingId === passkey.id}
                onDelete={() => onDelete(passkey)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground-muted">
            No passkeys yet. Add one for faster, password-free sign-in.
          </p>
        )}
      </CardContent>
    </Card>
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
      const { error } = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      })
      if (error) {
        toast.error(error.message ?? "Couldn't register passkey")
        return
      }
      toast.success("Passkey added")
      setOpen(false)
      setName("")
      await onAdded()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Passkey registration failed"
      )
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="primary" size="sm">
            <PlusIcon />
            Add passkey
          </Button>
        }
      />
      <DialogContent>
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
              <Input
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
              variant="outline"
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
}: {
  passkey: Passkey
  removing: boolean
  onDelete: () => void
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
          <KeyRoundIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{passkey.name || "Passkey"}</div>
          <p className="text-xs text-foreground-dim">
            Added {formatDate(passkey.createdAt)}
          </p>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="outline" size="sm" disabled={removing}>
              <Trash2Icon />
              Remove
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
    </li>
  )
}

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
