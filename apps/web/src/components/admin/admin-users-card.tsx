import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, Trash2Icon, UserPlusIcon } from "lucide-react"

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
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
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
} from "@workspace/ui/components/responsive-dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Progress } from "@workspace/ui/components/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/lib/toast"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { authClient } from "@/lib/auth-client"
import { api } from "@/lib/api"
import { SeedUserDialog } from "@/components/admin/seed-user-dialog"
import {
  formatBytes,
  formatQuotaGiB,
  parseQuotaGiB,
  storageUsagePercent,
} from "@/lib/storage-format"
import { displayName, userAvatar } from "@/lib/user-display"
import type { AdminUsersResponse, AdminUserStorageRow } from "@workspace/api"

type AdminUserRow = AdminUserStorageRow
const adminUsersQueryKey = ["admin", "users"] as const
const currentUserStorageQueryKey = ["user", "storage"] as const

interface AdminUsersCardProps {
  currentUserId: string
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

function useAdminUsersQuery() {
  const usersQuery = useQuery({
    queryKey: adminUsersQueryKey,
    queryFn: () => api.admin.fetchUsers(),
  })
  const { refetch } = usersQuery
  const refresh = React.useCallback(async () => {
    await refetch()
  }, [refetch])
  const loadError = usersQuery.error
    ? usersQuery.error instanceof Error
      ? usersQuery.error.message
      : "Failed to load users"
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
  setBusyId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (user: AdminUserRow) => {
    if (busyId) return
    setBusyId(user.id)
    try {
      const { error } = await authClient.admin.removeUser({ userId: user.id })
      if (error) throw new Error(error.message ?? "Delete failed")
      toast.success("User removed")
      await queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch {
      toast.error("Couldn't remove user")
    } finally {
      setBusyId(null)
    }
  }
}

function useChangeAdminUserRole({
  busyId,
  currentUserId,
  setBusyId,
}: {
  busyId: string | null
  currentUserId: string
  setBusyId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (user: AdminUserRow, nextRole: "admin" | "user") => {
    if (busyId) return
    const current = normalizeRole(user.role)
    if (current === nextRole) return
    if (user.id === currentUserId && nextRole !== "admin") {
      toast.error(
        "Demote yourself from the profile page after promoting another admin first."
      )
      return
    }
    setBusyId(user.id)
    try {
      const { error } = await authClient.admin.setRole({
        userId: user.id,
        role: nextRole,
      })
      if (error) throw new Error(error.message ?? "Role update failed")
      toast.success(
        nextRole === "admin" ? "Promoted to admin" : "Reverted to user"
      )
      await queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch {
      toast.error("Couldn't update role")
    } finally {
      setBusyId(null)
    }
  }
}

function useChangeAdminUserQuota({
  busyId,
  currentUserId,
  setBusyId,
}: {
  busyId: string | null
  currentUserId: string
  setBusyId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const queryClient = useQueryClient()
  return async (user: AdminUserRow, storageQuotaBytes: number | null) => {
    if (busyId) return
    setBusyId(user.id)
    try {
      const updated = await api.admin.updateUserStorageQuota(user.id, {
        storageQuotaBytes,
      })
      queryClient.setQueryData<AdminUsersResponse>(
        adminUsersQueryKey,
        (current) =>
          current
            ? {
                ...current,
                users: current.users.map((row) =>
                  row.id === updated.id ? updated : row
                ),
              }
            : current
      )
      if (updated.id === currentUserId) {
        void queryClient.invalidateQueries({
          queryKey: currentUserStorageQueryKey,
        })
      }
      toast.success("Storage quota updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update storage quota"
      )
    } finally {
      setBusyId(null)
    }
  }
}

function useAdminUserMutations(currentUserId: string) {
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const mutationState = { busyId, setBusyId }
  const onDelete = useDeleteAdminUser(mutationState)
  const onChangeQuota = useChangeAdminUserQuota({
    ...mutationState,
    currentUserId,
  })
  const onChangeRole = useChangeAdminUserRole({
    ...mutationState,
    currentUserId,
  })

  return {
    busyId,
    onDelete,
    onChangeRole,
    onChangeQuota,
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
    refresh,
    onDelete,
    onChangeRole,
    onChangeQuota,
  } = useAdminUsers(currentUserId)
  const [seedOpen, setSeedOpen] = React.useState(false)

  const seedDialog = (trigger: React.ReactNode) => (
    <ResponsiveDialog open={seedOpen} onOpenChange={setSeedOpen}>
      {trigger}
      <SeedUserDialog
        onCreated={async () => {
          setSeedOpen(false)
          await refresh()
        }}
      />
    </ResponsiveDialog>
  )

  const content = loadError ? (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {loadError}
    </div>
  ) : users === null ? (
    <div className="grid place-items-center py-3 text-foreground-muted">
      <Spinner className="size-4" />
    </div>
  ) : users.length === 0 ? (
    <p className="text-sm text-foreground-muted">No users yet.</p>
  ) : (
    <UsersTable
      users={users}
      currentUserId={currentUserId}
      busyId={busyId}
      onChangeRole={onChangeRole}
      onChangeQuota={onChangeQuota}
      onDelete={onDelete}
      action={
        hideHeader
          ? seedDialog(
              <ResponsiveDialogTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Seed user">
                    <UserPlusIcon className="size-4" />
                  </Button>
                }
              />
            )
          : undefined
      }
    />
  )

  if (hideHeader) {
    return content
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Users</SectionTitle>
        {seedDialog(
          <ResponsiveDialogTrigger
            render={<Button variant="primary" size="sm" />}
          >
            <UserPlusIcon />
            Seed user
          </ResponsiveDialogTrigger>
        )}
      </SectionHeader>
      <SectionContent>{content}</SectionContent>
    </Section>
  )
}

function UsersTable({
  users,
  currentUserId,
  busyId,
  onChangeRole,
  onChangeQuota,
  onDelete,
  action,
}: {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
  onChangeQuota: (user: AdminUserRow, storageQuotaBytes: number | null) => void
  onDelete: (user: AdminUserRow) => void
  action?: React.ReactNode
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-[240px]">Storage</TableHead>
          <TableHead className="w-[104px]">
            {action && <div className="flex justify-end">{action}</div>}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <UserTableRow
            key={user.id}
            user={user}
            currentUserId={currentUserId}
            busy={busyId === user.id}
            onChangeRole={onChangeRole}
            onChangeQuota={onChangeQuota}
            onDelete={onDelete}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function UserTableRow({
  user,
  currentUserId,
  busy,
  onChangeRole,
  onChangeQuota,
  onDelete,
}: {
  user: AdminUserRow
  currentUserId: string
  busy: boolean
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
  onChangeQuota: (user: AdminUserRow, storageQuotaBytes: number | null) => void
  onDelete: (user: AdminUserRow) => void
}) {
  const isSelf = user.id === currentUserId
  const name = displayName(user)
  const avatar = userAvatar(user)
  const avatarStyle = { background: avatar.bg, color: avatar.fg }

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="size-7" style={avatarStyle}>
            {avatar.src ? <AvatarImage src={avatar.src} alt={name} /> : null}
            <AvatarFallback style={avatarStyle}>
              {avatar.initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {isSelf ? (
              <Badge variant="outline" className="text-xs">
                You
              </Badge>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-foreground-muted">{user.email}</TableCell>
      <TableCell>
        <StorageUsageCell user={user} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <EditUserDialog
            user={user}
            busy={busy}
            onChangeQuota={onChangeQuota}
            onChangeRole={onChangeRole}
          />
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete user"
                  disabled={busy || isSelf}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {user.email}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes their sessions and clips. It can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onDelete(user)}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  )
}

function StorageUsageCell({ user }: { user: AdminUserRow }) {
  const pct = storageUsagePercent(user.storageUsedBytes, user.storageQuotaBytes)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-foreground-muted">
          {formatBytes(user.storageUsedBytes)}
        </span>
        <span className="shrink-0 text-foreground-faint tabular-nums">
          {user.storageQuotaBytes === null
            ? "Unlimited"
            : formatBytes(user.storageQuotaBytes)}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  )
}

function EditUserDialog({
  user,
  busy,
  onChangeQuota,
  onChangeRole,
}: {
  user: AdminUserRow
  busy: boolean
  onChangeQuota: (user: AdminUserRow, storageQuotaBytes: number | null) => void
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
}) {
  const [open, setOpen] = React.useState(false)
  const [quotaGiB, setQuotaGiB] = React.useState("")
  const [role, setRole] = React.useState<"admin" | "user">("user")

  React.useEffect(() => {
    if (open) {
      setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
      setRole(normalizeRole(user.role) as "admin" | "user")
    }
  }, [open, user.storageQuotaBytes, user.role])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      onChangeQuota(user, parseQuotaGiB(quotaGiB))
      onChangeRole(user, role)
      setOpen(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Invalid quota")
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit user"
            disabled={busy}
          >
            <PencilIcon className="size-4" />
          </Button>
        }
      />
      <ResponsiveDialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Edit user</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Update role and storage quota for {user.email}.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`role-${user.id}`}>Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "admin" | "user")}
                disabled={busy}
              >
                <SelectTrigger id={`role-${user.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`quota-${user.id}`}>
                Storage quota (GiB)
              </FieldLabel>
              <Input
                id={`quota-${user.id}`}
                type="number"
                min={1}
                step={1}
                value={quotaGiB}
                placeholder="Unlimited"
                disabled={busy}
                onChange={(e) => setQuotaGiB(e.target.value)}
              />
              <FieldDescription>
                Leave blank for unlimited storage.
              </FieldDescription>
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                />
              }
            >
              Cancel
            </ResponsiveDialogClose>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function normalizeRole(role: string | null | undefined): string {
  if (role === "admin") return "admin"
  return "user"
}
