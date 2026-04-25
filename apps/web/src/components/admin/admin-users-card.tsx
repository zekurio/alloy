import * as React from "react"
import { useForm } from "@tanstack/react-form"
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
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
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
import { validateEmail, validateUsername } from "@/lib/form-validators"
import {
  formatBytes,
  formatQuotaGiB,
  parseQuotaGiB,
  storageUsagePercent,
} from "@/lib/storage-format"
import {
  avatarTint,
  displayInitials,
  displayName,
  userImageSrc,
} from "@/lib/user-display"
import type { AdminUsersResponse, AdminUserStorageRow } from "@workspace/api"

type AdminUserRow = AdminUserStorageRow
const adminUsersQueryKey = ["admin", "users"] as const

interface AdminUsersCardProps {
  currentUserId: string
}

function useAdminUsers(currentUserId: string) {
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const usersQuery = useQuery({
    queryKey: adminUsersQueryKey,
    queryFn: () => api.admin.fetchUsers(),
  })
  const { refetch } = usersQuery
  const users = usersQuery.data?.users ?? null
  const loadError = usersQuery.error
    ? usersQuery.error instanceof Error
      ? usersQuery.error.message
      : "Failed to load users"
    : null
  const refresh = React.useCallback(async () => {
    await refetch()
  }, [refetch])

  const onDelete = async (user: AdminUserRow) => {
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

  const onChangeRole = async (
    user: AdminUserRow,
    nextRole: "admin" | "user"
  ) => {
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

  const onChangeQuota = async (
    user: AdminUserRow,
    storageQuotaBytes: number | null
  ) => {
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
      toast.success("Storage quota updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update storage quota"
      )
    } finally {
      setBusyId(null)
    }
  }

  return {
    users,
    loadError,
    busyId,
    refresh,
    onDelete,
    onChangeRole,
    onChangeQuota,
  }
}

export function AdminUsersCard({ currentUserId }: AdminUsersCardProps) {
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

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Users</SectionTitle>
        <Dialog open={seedOpen} onOpenChange={setSeedOpen}>
          <DialogTrigger render={<Button variant="primary" size="sm" />}>
            <UserPlusIcon />
            Seed user
          </DialogTrigger>
          <SeedUserDialog
            onCreated={async () => {
              setSeedOpen(false)
              await refresh()
            }}
          />
        </Dialog>
      </SectionHeader>

      <SectionContent>
        {loadError ? (
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
          />
        )}
      </SectionContent>
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
}: {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
  onChangeQuota: (user: AdminUserRow, storageQuotaBytes: number | null) => void
  onDelete: (user: AdminUserRow) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-[240px]">Storage</TableHead>
          <TableHead className="w-[160px]">Role</TableHead>
          <TableHead className="w-[104px]" />
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
  const role = normalizeRole(user.role)
  const isSelf = user.id === currentUserId
  const name = displayName(user)
  const { bg, fg } = avatarTint(user.id || name)

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarImage src={userImageSrc(user.image)} />
            <AvatarFallback style={{ background: bg, color: fg }}>
              {displayInitials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {isSelf ? (
              <Badge variant="outline" className="text-xs">
                You
              </Badge>
            ) : null}
            {user.banned ? (
              <Badge variant="destructive" className="text-xs">
                Banned
              </Badge>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-foreground-muted">{user.email}</TableCell>
      <TableCell>
        <StorageUsageCell user={user} />
      </TableCell>
      <TableCell>
        <Select
          value={role}
          onValueChange={(value) =>
            onChangeRole(user, value as "admin" | "user")
          }
          disabled={busy}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <StorageQuotaDialog
            user={user}
            busy={busy}
            onChangeQuota={onChangeQuota}
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

function StorageQuotaDialog({
  user,
  busy,
  onChangeQuota,
}: {
  user: AdminUserRow
  busy: boolean
  onChangeQuota: (user: AdminUserRow, storageQuotaBytes: number | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [quotaGiB, setQuotaGiB] = React.useState("")

  React.useEffect(() => {
    if (open) setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
  }, [open, user.storageQuotaBytes])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      onChangeQuota(user, parseQuotaGiB(quotaGiB))
      setOpen(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Invalid quota")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit storage quota"
            disabled={busy}
          >
            <PencilIcon className="size-4" />
          </Button>
        }
      />
      <DialogContent variant="secondary">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit storage quota</DialogTitle>
            <DialogDescription>
              Set the source clip storage quota for {user.email}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
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
          </DialogBody>
          <DialogFooter>
            <DialogClose
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
            </DialogClose>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save quota"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function normalizeRole(role: string | null | undefined): string {
  if (role === "admin") return "admin"
  return "user"
}

function SeedUserDialog({
  onCreated,
}: {
  onCreated: () => void | Promise<void>
}) {
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
      role: "user" as "user" | "admin",
    } as { username: string; email: string; role: "user" | "admin" },
    onSubmit: async ({ value }) => {
      try {
        const { error } = await authClient.admin.createUser({
          name: value.username.trim(),
          email: value.email.trim(),
          role: value.role,
        })
        if (error) throw new Error(error.message ?? "Create failed")
        toast.success("User seeded")
        form.reset()
        await onCreated()
      } catch {
        toast.error("Couldn't seed user")
      }
    },
  })

  return (
    <DialogContent variant="secondary">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <DialogHeader>
          <DialogTitle>Seed a user</DialogTitle>
          <DialogDescription>
            Creates a passwordless account. The user signs in via OAuth and
            their identity links to this email.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <form.Field
            name="username"
            validators={{
              onChange: ({ value }) => validateUsername(value.trim()),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Username
                  </FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(e.target.value.toLowerCase())
                    }
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldDescription>
                    Used to sign in. Lowercase letters, numbers, `_` and `-`.
                  </FieldDescription>
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) => validateEmail(value),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Email
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldDescription>
                    Must match the email returned by the OAuth provider.
                  </FieldDescription>
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Role</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as "user" | "admin")
                  }
                  disabled={form.state.isSubmitting}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.state.isSubmitting}
              />
            }
          >
            Cancel
          </DialogClose>
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
              >
                {isSubmitting ? "Seeding…" : "Seed user"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
