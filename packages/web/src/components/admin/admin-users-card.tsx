import type { AdminUsersResponse, AdminUserStorageRow } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import { List, ListItem } from "@alloy/ui/components/list"
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
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  PencilIcon,
  SaveIcon,
  Trash2Icon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Dispatch, FormEvent, SetStateAction } from "react"

import { adminKeys, adminUsersQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import {
  formatBytes,
  formatQuotaGiB,
  parseQuotaGiB,
} from "@/lib/storage-format"
import { displayName, userAvatar } from "@/lib/user-display"
import { userKeys } from "@/lib/user-queries"

import { normalizeRole } from "./admin-user-role"

type AdminUserRow = AdminUserStorageRow
type AdminUserEditableFields = {
  role: "admin" | "user"
  storageQuotaBytes: number | null
}

interface AdminUsersCardProps {
  currentUserId: string
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

function useAdminUsersQuery() {
  const usersQuery = useQuery(adminUsersQueryOptions())
  const { refetch } = usersQuery
  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])
  const loadError = usersQuery.error
    ? errorMessage(usersQuery.error, t("Failed to load users"))
    : null

  return {
    users: usersQuery.data?.users ?? null,
    loadError,
    refresh,
  }
}

function useDeleteAdminUser({
  busyId,
  setBusyId,
}: {
  busyId: string | null
  setBusyId: Dispatch<SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (user: AdminUserRow) => {
    if (busyId) return
    setBusyId(user.id)
    try {
      await api.admin.deleteUser(user.id)
      toast.success(t("User removed"))
      await queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't remove user")))
    } finally {
      setBusyId(null)
    }
  }
}

function useToggleAdminUserStatus({
  busyId,
  setBusyId,
}: {
  busyId: string | null
  setBusyId: Dispatch<SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (user: AdminUserRow) => {
    if (busyId) return
    const nextStatus = user.status === "disabled" ? "active" : "disabled"
    setBusyId(user.id)
    try {
      const updated = await api.admin.updateUser(user.id, {
        status: nextStatus,
      })
      setAdminUserCacheRow(queryClient, updated)
      toast.success(
        nextStatus === "disabled" ? t("User disabled") : t("User enabled"),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update user")))
    } finally {
      setBusyId(null)
    }
  }
}

function setAdminUserCacheRow(queryClient: QueryClient, updated: AdminUserRow) {
  queryClient.setQueryData<AdminUsersResponse>(adminKeys.users(), (current) =>
    current
      ? {
          ...current,
          users: current.users.map((row) =>
            row.id === updated.id ? updated : row,
          ),
        }
      : current,
  )
}

function adminUserEditableFields(user: AdminUserRow): AdminUserEditableFields {
  return {
    role: normalizeRole(user.role),
    storageQuotaBytes: user.storageQuotaBytes,
  }
}

function adminUserFieldsEqual(
  left: AdminUserEditableFields,
  right: AdminUserEditableFields,
): boolean {
  return (
    left.role === right.role &&
    left.storageQuotaBytes === right.storageQuotaBytes
  )
}

function useUpdateAdminUser({
  busyId,
  currentUserId,
  setBusyId,
}: {
  busyId: string | null
  currentUserId: string
  setBusyId: Dispatch<SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (
    user: AdminUserRow,
    next: AdminUserEditableFields,
  ): Promise<boolean> => {
    if (busyId) return false
    const current = adminUserEditableFields(user)
    const roleChanged = current.role !== next.role
    const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes
    if (!roleChanged && !quotaChanged) return true

    if (user.id === currentUserId && roleChanged && next.role !== "admin") {
      toast.error(
        t(
          "Demote yourself from the profile page after promoting another admin first.",
        ),
      )
      return false
    }

    setBusyId(user.id)
    try {
      const updated = await api.admin.updateUser(user.id, {
        ...(roleChanged ? { role: next.role } : {}),
        ...(quotaChanged ? { storageQuotaBytes: next.storageQuotaBytes } : {}),
      })
      setAdminUserCacheRow(queryClient, updated)
      if (updated.id === currentUserId && quotaChanged) {
        await queryClient.invalidateQueries({
          queryKey: userKeys.storage(),
        })
      }
      toast.success(t("User updated"))
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update user")))
      return false
    } finally {
      setBusyId(null)
    }
  }
}

function useAdminUserMutations(currentUserId: string) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const mutationState = { busyId, setBusyId }
  const onDelete = useDeleteAdminUser(mutationState)
  const onToggleStatus = useToggleAdminUserStatus(mutationState)
  const onUpdate = useUpdateAdminUser({
    ...mutationState,
    currentUserId,
  })

  return {
    busyId,
    onDelete,
    onToggleStatus,
    onUpdate,
  }
}

function useAdminUsers(currentUserId: string) {
  return {
    ...useAdminUsersQuery(),
    ...useAdminUserMutations(currentUserId),
  }
}

export function AdminUsersCard({
  currentUserId,
  hideHeader,
}: AdminUsersCardProps) {
  const { users, loadError, busyId, onDelete, onToggleStatus, onUpdate } =
    useAdminUsers(currentUserId)

  const content = loadError ? (
    <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
      {loadError}
    </div>
  ) : users === null ? (
    <div className="text-foreground-muted grid place-items-center py-3">
      <Spinner className="size-4" />
    </div>
  ) : users.length === 0 ? (
    <p className="text-foreground-muted text-sm">{t("No users yet.")}</p>
  ) : (
    <UsersList
      users={users}
      currentUserId={currentUserId}
      busyId={busyId}
      onUpdate={onUpdate}
      onToggleStatus={onToggleStatus}
      onDelete={onDelete}
    />
  )

  if (hideHeader) {
    return content
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Users")}</SectionTitle>
      </SectionHeader>
      <SectionContent>{content}</SectionContent>
    </Section>
  )
}

function UsersList({
  users,
  currentUserId,
  busyId,
  onUpdate,
  onToggleStatus,
  onDelete,
}: {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onUpdate: (
    user: AdminUserRow,
    next: AdminUserEditableFields,
  ) => Promise<boolean>
  onToggleStatus: (user: AdminUserRow) => void
  onDelete: (user: AdminUserRow) => void
}) {
  return (
    <List>
      {users.map((user) => (
        <UserListRow
          key={user.id}
          user={user}
          currentUserId={currentUserId}
          busy={busyId === user.id}
          onUpdate={onUpdate}
          onToggleStatus={onToggleStatus}
          onDelete={onDelete}
        />
      ))}
    </List>
  )
}

function UserListRow({
  user,
  currentUserId,
  busy,
  onUpdate,
  onToggleStatus,
  onDelete,
}: {
  user: AdminUserRow
  currentUserId: string
  busy: boolean
  onUpdate: (
    user: AdminUserRow,
    next: AdminUserEditableFields,
  ) => Promise<boolean>
  onToggleStatus: (user: AdminUserRow) => void
  onDelete: (user: AdminUserRow) => void
}) {
  const isSelf = user.id === currentUserId
  const isDisabled = user.status === "disabled"
  const name = displayName(user)
  const avatar = userAvatar(user)
  const avatarStyle = { background: avatar.bg, color: avatar.fg }
  const clipLabel = tp(user.clipCount, "clip", "clips")

  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar className="size-8 shrink-0" style={avatarStyle}>
          {avatar.src ? <AvatarImage src={avatar.src} alt={name} /> : null}
          <AvatarFallback style={avatarStyle}>{avatar.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            {isSelf ? (
              <Badge variant="outline" className="shrink-0 text-xs">
                {t("You")}
              </Badge>
            ) : null}
            {isDisabled ? (
              <Badge variant="destructive" className="shrink-0 text-xs">
                {t("Disabled")}
              </Badge>
            ) : null}
          </div>
          <p className="text-foreground-dim truncate text-xs">{user.email}</p>
          <p className="text-foreground-muted truncate text-xs">
            {user.clipCount} {clipLabel} {"·"}
            {formatBytes(user.storageUsedBytes)}
            {user.storageQuotaBytes !== null
              ? ` ${t("of")} ${formatBytes(user.storageQuotaBytes)}`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <EditUserDialog user={user} busy={busy} onUpdate={onUpdate} />
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={isDisabled ? t("Enable user") : t("Disable user")}
                disabled={busy || isSelf}
              >
                {isDisabled ? (
                  <UserCheckIcon className="size-3.5" />
                ) : (
                  <UserXIcon className="size-3.5" />
                )}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isDisabled
                  ? t("Enable {email}?", { email: user.email })
                  : t("Disable {email}?", { email: user.email })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isDisabled
                  ? t(
                      "They'll be able to sign in and their clips will be visible again.",
                    )
                  : t(
                      "They'll be signed out and their clips hidden. Their data is kept and you can enable them again later.",
                    )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={isDisabled ? "primary" : "destructive"}
                onClick={() => onToggleStatus(user)}
                disabled={busy}
              >
                {isDisabled ? t("Enable") : t("Disable")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Delete user")}
                disabled={busy || isSelf}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Delete {email}?", { email: user.email })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "This removes their sessions and clips. It can't be undone.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => onDelete(user)}
                disabled={busy}
              >
                {busy ? t("Deleting…") : t("Delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ListItem>
  )
}

function EditUserDialog({
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
    if (open) {
      setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
      setRole(normalizeRole(user.role) as "admin" | "user")
    }
  }, [open, user.storageQuotaBytes, user.role])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
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
                onValueChange={(v) => setRole(v as "admin" | "user")}
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
                onChange={(e) => setQuotaGiB(e.target.value)}
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
