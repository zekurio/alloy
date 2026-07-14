import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
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
import { toast } from "@alloy/ui/lib/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, SaveIcon, UserPlusIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { formatQuotaGiB, parseQuotaGiB } from "@/lib/storage-format"

import {
  adminUserEditableFields,
  adminUserFieldsEqual,
  type AdminUserEditableFields,
  type AdminUserRow,
} from "./admin-user-data"
import { normalizeRole } from "./admin-user-role"

export function EditUserDialog({
  user,
  busy,
  onUpdate,
}: {
  user: AdminUserRow
  busy: boolean
  onUpdate: (
    user: AdminUserRow,
    next: AdminUserEditableFields,
  ) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [quotaGiB, setQuotaGiB] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")
  const [submitting, setSubmitting] = useState(false)
  const saving = busy || submitting
  const parsedQuota = useMemo(() => {
    try {
      return { ok: true as const, value: parseQuotaGiB(quotaGiB) }
    } catch {
      return { ok: false as const }
    }
  }, [quotaGiB])
  const currentFields = adminUserEditableFields(user)
  const nextFields = parsedQuota.ok
    ? { role, storageQuotaBytes: parsedQuota.value }
    : null
  const dirty = nextFields
    ? !adminUserFieldsEqual(currentFields, nextFields)
    : true

  useEffect(() => {
    if (!open) return
    setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
    setRole(normalizeRole(user.role))
  }, [open, user.storageQuotaBytes, user.role])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (nextFields && !dirty) {
      setOpen(false)
      return
    }

    let storageQuotaBytes: number | null
    try {
      storageQuotaBytes = parseQuotaGiB(quotaGiB)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Invalid quota")))
      return
    }

    setSubmitting(true)
    try {
      const saved = await onUpdate(user, { role, storageQuotaBytes })
      if (saved) setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Edit user")}
            disabled={busy}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      />
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
            <Field>
              <FieldLabel htmlFor={`role-${user.id}`}>{t("Role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as "admin" | "user")}
                disabled={saving}
              >
                <SelectTrigger id={`role-${user.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("User")}</SelectItem>
                  <SelectItem value="admin">{t("Admin")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
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
                disabled={saving}
                onChange={(event) => setQuotaGiB(event.target.value)}
              />
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                />
              }
            >
              {t("Cancel")}
            </ResponsiveDialogClose>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving || !dirty}
            >
              <SaveIcon />
              {saving ? t("Saving…") : t("Save")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function CreateUserDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  useEffect(() => {
    if (!open) return
    setEmail("")
    setUsername("")
    setRole("user")
  }, [open])

  const { isPending, mutate } = useMutation({
    mutationFn: (input: {
      email: string
      username?: string
      role: "admin" | "user"
    }) => api.admin.createUser(input),
    onSuccess: () => {
      toast.success(t("User created"))
      setOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't create user"))),
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return
    const trimmedUsername = username.trim()
    mutate({
      email: trimmedEmail,
      ...(trimmedUsername ? { username: trimmedUsername } : {}),
      role,
    })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button variant="primary">
            <UserPlusIcon />
            {t("Add user")}
          </Button>
        }
      />
      <ResponsiveDialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t("Create user")}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t(
                "They can claim the account by signing in with an identity provider that uses this email.",
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="create-user-email">{t("Email")}</FieldLabel>
              <Input
                id="create-user-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                disabled={isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-user-username">
                {t("Username")}
              </FieldLabel>
              <Input
                id="create-user-username"
                value={username}
                placeholder={t("Optional")}
                disabled={isPending}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-user-role">{t("Role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as "admin" | "user")}
                disabled={isPending}
              >
                <SelectTrigger id="create-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("User")}</SelectItem>
                  <SelectItem value="admin">{t("Admin")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                />
              }
            >
              {t("Cancel")}
            </ResponsiveDialogClose>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isPending}
            >
              <UserPlusIcon />
              {isPending ? t("Creating…") : t("Create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
