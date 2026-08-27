import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
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
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { SaveIcon, UserPlusIcon } from "lucide-react"
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
  const setOpen = onOpenChange
  const [quotaGiB, setQuotaGiB] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
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
    setSubmitError(null)
    if (nextFields && !dirty) {
      setOpen(false)
      return
    }

    let storageQuotaBytes: number | null
    try {
      storageQuotaBytes = parseQuotaGiB(quotaGiB)
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Invalid quota")))
      return
    }

    setSubmitting(true)
    try {
      await onUpdate(user, { role, storageQuotaBytes })
      setOpen(false)
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Couldn't update user")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
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
                onValueChange={(value) => {
                  if (value === "admin" || value === "user") setRole(value)
                }}
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
            <FeedbackButton
              type="submit"
              variant="primary"
              size="sm"
              state={saving ? "pending" : submitError ? "error" : "idle"}
              pendingLabel={t("Saving…")}
              errorLabel={t("Try again")}
              disabled={saving || !dirty}
            >
              <SaveIcon />
              {t("Save")}
            </FeedbackButton>
          </ResponsiveDialogFooter>
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

  useEffect(() => {
    if (!open) return
    setUsername("")
    setRole("user")
  }, [open])

  const { error, isPending, mutate } = useMutation({
    mutationFn: (input: { username: string; role: "admin" | "user" }) =>
      api.admin.createUser(input),
    onSuccess: () => {
      setOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    },
  })
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
            <Field>
              <FieldLabel htmlFor="create-user-role">{t("Role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => {
                  if (value === "admin" || value === "user") setRole(value)
                }}
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
            <FeedbackButton
              type="submit"
              variant="primary"
              size="sm"
              state={isPending ? "pending" : submitError ? "error" : "idle"}
              pendingLabel={t("Creating…")}
              errorLabel={t("Try again")}
              disabled={isPending}
            >
              <UserPlusIcon />
              {t("Create")}
            </FeedbackButton>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
