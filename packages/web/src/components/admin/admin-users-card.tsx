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
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import {
  PencilIcon,
  SaveIcon,
  Trash2Icon,
  UserCheckIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"

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
type UpdateAdminUserVariables = {
  user: AdminUserRow
  next: AdminUserEditableFields
}

interface AdminUsersCardProps {
  currentUserId: string
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

function useAdminUsersQuery() {
  const usersQuery = useInfiniteQuery(adminUsersQueryOptions())
  const loadError = usersQuery.error
    ? errorMessage(usersQuery.error, t("Failed to load users"))
    : null

  return {
    users: usersQuery.data
      ? usersQuery.data.pages.flatMap((page) => page.users)
      : null,
    loadError,
    hasNextPage: usersQuery.hasNextPage,
    isFetchingNextPage: usersQuery.isFetchingNextPage,
    fetchNextPage: usersQuery.fetchNextPage,
  }
}

function useDeleteAdminUser() {
  const queryClient = useQueryClient()
  const { isPending, mutate, variables } = useMutation({
    mutationFn: (user: AdminUserRow) => api.admin.deleteUser(user.id),
    onSuccess: (_result, user) => {
      removeAdminUserCacheRow(queryClient, user.id)
      toast.success(t("User removed"))
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't remove user"))),
  })
  const onDelete = useCallback((user: AdminUserRow) => mutate(user), [mutate])

  return {
    busyId: isPending ? (variables?.id ?? null) : null,
    onDelete,
  }
}

function useToggleAdminUserStatus() {
  const queryClient = useQueryClient()
  const { isPending, mutate, variables } = useMutation({
    mutationFn: (user: AdminUserRow) =>
      api.admin.updateUser(user.id, {
        status: user.status === "disabled" ? "active" : "disabled",
      }),
    onSuccess: (updated) => {
      setAdminUserCacheRow(queryClient, updated)
      toast.success(
        updated.status === "disabled" ? t("User disabled") : t("User enabled"),
      )
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update user"))),
  })
  const onToggleStatus = useCallback(
    (user: AdminUserRow) => mutate(user),
    [mutate],
  )

  return {
    busyId: isPending ? (variables?.id ?? null) : null,
    onToggleStatus,
  }
}

function setAdminUserCacheRow(queryClient: QueryClient, updated: AdminUserRow) {
  queryClient.setQueryData<InfiniteData<AdminUsersResponse>>(
    adminKeys.users(),
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              users: page.users.map((row) =>
                row.id === updated.id ? updated : row,
              ),
            })),
          }
        : current,
  )
}

function removeAdminUserCacheRow(queryClient: QueryClient, userId: string) {
  queryClient.setQueryData<InfiniteData<AdminUsersResponse>>(
    adminKeys.users(),
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              users: page.users.filter((row) => row.id !== userId),
            })),
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

function useUpdateAdminUser(currentUserId: string) {
  const queryClient = useQueryClient()
  const { isPending, mutateAsync, variables } = useMutation({
    mutationFn: ({ user, next }: UpdateAdminUserVariables) => {
      const current = adminUserEditableFields(user)
      const roleChanged = current.role !== next.role
      const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes

      return api.admin.updateUser(user.id, {
        ...(roleChanged ? { role: next.role } : {}),
        ...(quotaChanged ? { storageQuotaBytes: next.storageQuotaBytes } : {}),
      })
    },
    onSuccess: async (updated, { user, next }) => {
      const quotaChanged = user.storageQuotaBytes !== next.storageQuotaBytes
      setAdminUserCacheRow(queryClient, updated)
      if (updated.id === currentUserId && quotaChanged) {
        await queryClient.invalidateQueries({
          queryKey: userKeys.storage(),
        })
      }
      toast.success(t("User updated"))
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update user"))),
  })
  const onUpdate = useCallback(
    (user: AdminUserRow, next: AdminUserEditableFields): Promise<boolean> => {
      const current = adminUserEditableFields(user)
      const roleChanged = current.role !== next.role
      const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes
      if (!roleChanged && !quotaChanged) return Promise.resolve(true)

      if (user.id === currentUserId && roleChanged && next.role !== "admin") {
        toast.error(
          t(
            "Demote yourself from the profile page after promoting another admin first.",
          ),
        )
        return Promise.resolve(false)
      }

      return mutateAsync({ user, next }).then(
        () => true,
        () => false,
      )
    },
    [currentUserId, mutateAsync],
  )

  return {
    busyId: isPending ? (variables?.user.id ?? null) : null,
    onUpdate,
  }
}

function useAdminUserMutations(currentUserId: string) {
  const deleteMutation = useDeleteAdminUser()
  const toggleStatusMutation = useToggleAdminUserStatus()
  const updateMutation = useUpdateAdminUser(currentUserId)

  return {
    busyId:
      deleteMutation.busyId ??
      toggleStatusMutation.busyId ??
      updateMutation.busyId,
    onDelete: deleteMutation.onDelete,
    onToggleStatus: toggleStatusMutation.onToggleStatus,
    onUpdate: updateMutation.onUpdate,
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
  const {
    users,
    loadError,
    busyId,
    onDelete,
    onToggleStatus,
    onUpdate,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useAdminUsers(currentUserId)

  const list = loadError ? (
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
    <>
      <UsersList
        users={users}
        currentUserId={currentUserId}
        busyId={busyId}
        onUpdate={onUpdate}
        onToggleStatus={onToggleStatus}
        onDelete={onDelete}
      />
      {hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? t("Loading…") : t("Load more")}
        </Button>
      ) : null}
    </>
  )

  const content = (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <CreateUserDialog />
      </div>
      {list}
    </div>
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

const UserListRow = memo(function UserListRow({
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
              <Badge variant="outline" size="text" className="shrink-0">
                {t("You")}
              </Badge>
            ) : null}
            {isDisabled ? (
              <Badge variant="destructive" size="text" className="shrink-0">
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
})

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

function CreateUserDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  useEffect(() => {
    if (open) {
      setEmail("")
      setUsername("")
      setRole("user")
    }
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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
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
          <Button variant="secondary" size="sm">
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
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-user-role">{t("Role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "admin" | "user")}
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
