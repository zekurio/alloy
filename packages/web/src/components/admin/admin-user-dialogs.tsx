import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { SaveIcon, UserPlusIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { formatQuotaGiB, parseQuotaGiB } from "@/lib/storage-format"

import { AdminDialogFooter } from "./admin-dialog-footer"
import {
  adminUserFieldChanges,
  type AdminUserEditableFields,
  type AdminUserRow,
} from "./admin-user-data"
import { normalizeRole } from "./admin-user-role"

export function EditUserDialog({
  user,
  busy,
  open,
  onOpenChange,
  onUpdate,
}: {
  user: AdminUserRow
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (user: AdminUserRow, next: AdminUserEditableFields) => Promise<void>
}) {
  const [quotaGiB, setQuotaGiB] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const quota = useMemo(() => {
    try {
      return { bytes: parseQuotaGiB(quotaGiB), error: null }
    } catch (cause) {
      return { bytes: null, error: errorMessage(cause, t("Invalid quota")) }
    }
  }, [quotaGiB])
  const nextFields =
    quota.error === null ? { role, storageQuotaBytes: quota.bytes } : null
  // An invalid quota keeps Save enabled so submitting can say what is wrong.
  const dirty = nextFields
    ? adminUserFieldChanges(user, nextFields) !== null
    : true

  useEffect(() => {
    if (!open) return
    setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
    setRole(normalizeRole(user.role))
    setSubmitError(null)
  }, [open, user.storageQuotaBytes, user.role])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setSubmitError(quota.error)
    if (!nextFields) return
    if (!dirty) {
      onOpenChange(false)
      return
    }

    try {
      await onUpdate(user, nextFields)
      onOpenChange(false)
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Couldn't update user")))
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t("Edit user")}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t("Update role and storage quota for {username}.", {
                username: user.username,
              })}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <RoleField
              id={`role-${user.id}`}
              value={role}
              disabled={busy}
              onValueChange={setRole}
            />
            <FieldError>{submitError}</FieldError>
            <Field>
              <FieldLabel htmlFor={`quota-${user.id}`}>
                {t("Storage quota (GiB)")}
              </FieldLabel>
              <Input
                id={`quota-${user.id}`}
                type="number"
                min={1}
                step={1}
                value={quotaGiB}
                placeholder={t("Unlimited")}
                disabled={busy}
                onChange={(event) => setQuotaGiB(event.target.value)}
              />
            </Field>
          </ResponsiveDialogBody>
          <AdminDialogFooter
            pending={busy}
            failed={Boolean(submitError)}
            disabled={!dirty}
            pendingLabel={t("Saving…")}
          >
            <SaveIcon />
            {t("Save")}
          </AdminDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function CreateUserDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  const { error, isPending, mutate, reset } = useMutation({
    mutationFn: (input: { username: string; role: "admin" | "user" }) =>
      api.admin.createUser(input),
    onSuccess: () => {
      setOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    },
  })

  useEffect(() => {
    if (!open) return
    setUsername("")
    setRole("user")
    reset()
  }, [open, reset])

  const submitError = error
    ? errorMessage(error, t("Couldn't create user"))
    : null

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    const trimmedUsername = username.trim()
    if (!trimmedUsername) return
    mutate({ username: trimmedUsername, role })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button variant="primary" size="icon" aria-label={t("Add user")}>
            <UserPlusIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t("Create user")}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="create-user-username">
                {t("Username")}
              </FieldLabel>
              <Input
                id="create-user-username"
                required
                value={username}
                disabled={isPending}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <FieldError>{submitError}</FieldError>
            <RoleField
              id="create-user-role"
              value={role}
              disabled={isPending}
              onValueChange={setRole}
            />
          </ResponsiveDialogBody>
          <AdminDialogFooter
            pending={isPending}
            failed={Boolean(submitError)}
            pendingLabel={t("Creating…")}
          >
            <UserPlusIcon />
            {t("Create")}
          </AdminDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function RoleField({
  id,
  value,
  disabled,
  onValueChange,
}: {
  id: string
  value: "admin" | "user"
  disabled: boolean
  onValueChange: (role: "admin" | "user") => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("Role")}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === "admin" || next === "user") onValueChange(next)
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="user">{t("User")}</SelectItem>
          <SelectItem value="admin">{t("Admin")}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}
