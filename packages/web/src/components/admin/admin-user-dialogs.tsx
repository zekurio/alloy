import { t } from "@alloy/i18n"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@alloy/ui/components/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { SaveIcon } from "lucide-react"

import { errorMessage } from "@/lib/error-message"
import { formatQuotaGiB, parseQuotaGiB } from "@/lib/storage-format"

import { AdminDialogFooter } from "./admin-dialog-footer"
import {
  adminUserFieldChanges,
  type AdminUserEditableFields,
  type AdminUserRow,
} from "./admin-user-data"
import { normalizeRole } from "./admin-user-role"

type UserRole = "admin" | "user"

type EditUserValues = {
  quotaGiB: string
  role: UserRole
}

function quotaError(quotaGiB: string): string | undefined {
  try {
    parseQuotaGiB(quotaGiB)
    return undefined
  } catch (cause) {
    return errorMessage(cause, t("Invalid quota"))
  }
}

function editedUserFields(values: EditUserValues): AdminUserEditableFields {
  return {
    role: values.role,
    storageQuotaBytes: parseQuotaGiB(values.quotaGiB),
  }
}

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
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent variant="secondary">
        {/* Saved changes reseed the draft; closing discards it. */}
        <EditUserForm
          key={`${user.role}:${user.storageQuotaBytes}`}
          user={user}
          busy={busy}
          onClose={() => onOpenChange(false)}
          onUpdate={onUpdate}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function EditUserForm({
  user,
  busy,
  onClose,
  onUpdate,
}: {
  user: AdminUserRow
  busy: boolean
  onClose: () => void
  onUpdate: (user: AdminUserRow, next: AdminUserEditableFields) => Promise<void>
}) {
  const update = useMutation({
    mutationFn: (next: AdminUserEditableFields) => onUpdate(user, next),
    onSuccess: onClose,
  })
  const form = useForm({
    defaultValues: {
      quotaGiB: formatQuotaGiB(user.storageQuotaBytes),
      role: normalizeRole(user.role),
    } satisfies EditUserValues,
    onSubmit: ({ value }) => {
      if (busy) return
      const next = editedUserFields(value)
      if (adminUserFieldChanges(user, next) === null) {
        onClose()
        return
      }
      update.mutate(next)
    },
  })
  // An invalid quota keeps Save enabled so submitting can say what is wrong.
  const dirty = useStore(
    form.store,
    (state) =>
      quotaError(state.values.quotaGiB) !== undefined ||
      adminUserFieldChanges(user, editedUserFields(state.values)) !== null,
  )
  const invalidQuota = useStore(
    form.store,
    (state) => state.fieldMeta.quotaGiB?.errors[0],
  )
  const submitError =
    invalidQuota ??
    (update.error
      ? errorMessage(update.error, t("Couldn't update user"))
      : null)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t("Edit user")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t("Update role and storage quota for {username}.", {
            username: user.username,
          })}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody className="flex flex-col gap-4">
        <form.Field name="role">
          {(field) => (
            <RoleField
              id={`role-${user.id}`}
              value={field.state.value}
              disabled={busy}
              onValueChange={field.handleChange}
            />
          )}
        </form.Field>
        <FieldError>{submitError}</FieldError>
        <form.Field
          name="quotaGiB"
          validators={{ onSubmit: ({ value }) => quotaError(value) }}
        >
          {(field) => (
            <Field>
              <FieldLabel htmlFor={`quota-${user.id}`}>
                {t("Storage quota (GiB)")}
              </FieldLabel>
              <Input
                id={`quota-${user.id}`}
                type="number"
                min={1}
                step={1}
                value={field.state.value}
                placeholder={t("Unlimited")}
                disabled={busy}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
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
  )
}

function RoleField({
  id,
  value,
  disabled,
  onValueChange,
}: {
  id: string
  value: UserRole
  disabled: boolean
  onValueChange: (role: UserRole) => void
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
