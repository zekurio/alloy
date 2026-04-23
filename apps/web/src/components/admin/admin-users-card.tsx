import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { Trash2Icon, UserPlusIcon } from "lucide-react"

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { authClient } from "@/lib/auth-client"
import { validateEmail, validateUsername } from "@/lib/form-validators"
import { avatarTint, displayInitials, displayName } from "@/lib/user-display"

interface AdminUserRow {
  id: string
  name: string
  username: string
  email: string
  image?: string | null
  role?: string | string[] | null
  banned?: boolean | null
  createdAt: string | Date
}

interface AdminUsersCardProps {
  currentUserId: string
}

function asAdminUserRows(input: unknown): AdminUserRow[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return []
    const row = value as Record<string, unknown>
    const createdAt = row.createdAt
    if (
      typeof row.id !== "string" ||
      typeof row.email !== "string" ||
      (typeof createdAt !== "string" && !(createdAt instanceof Date))
    ) {
      return []
    }
    return [
      {
        id: row.id,
        name: typeof row.name === "string" ? row.name : "",
        username: typeof row.username === "string" ? row.username : "",
        email: row.email,
        image:
          typeof row.image === "string" || row.image === null
            ? row.image
            : null,
        role:
          typeof row.role === "string" ||
          row.role === null ||
          Array.isArray(row.role)
            ? (row.role as AdminUserRow["role"])
            : null,
        banned:
          typeof row.banned === "boolean" || row.banned === null
            ? row.banned
            : null,
        createdAt,
      },
    ]
  })
}

function useAdminUsers(currentUserId: string) {
  const [users, setUsers] = React.useState<AdminUserRow[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 100 },
      })
      if (error) throw new Error(error.message ?? "Failed to load users")
      setUsers(asAdminUserRows(data?.users))
      setLoadError(null)
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : "Failed to load users"
      )
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const onDelete = async (user: AdminUserRow) => {
    if (busyId) return
    setBusyId(user.id)
    try {
      const { error } = await authClient.admin.removeUser({ userId: user.id })
      if (error) throw new Error(error.message ?? "Delete failed")
      toast.success("User removed")
      await refresh()
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
      await refresh()
    } catch {
      toast.error("Couldn't update role")
    } finally {
      setBusyId(null)
    }
  }

  return { users, loadError, busyId, refresh, onDelete, onChangeRole }
}

export function AdminUsersCard({ currentUserId }: AdminUsersCardProps) {
  const { users, loadError, busyId, refresh, onDelete, onChangeRole } =
    useAdminUsers(currentUserId)
  const [seedOpen, setSeedOpen] = React.useState(false)

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>Manage accounts on this instance.</CardDescription>
        </div>
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
      </CardHeader>

      <CardContent>
        {loadError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {loadError}
          </div>
        ) : users === null ? (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner className="size-4" /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-foreground-muted">No users yet.</p>
        ) : (
          <UsersTable
            users={users}
            currentUserId={currentUserId}
            busyId={busyId}
            onChangeRole={onChangeRole}
            onDelete={onDelete}
          />
        )}
      </CardContent>
    </Card>
  )
}

function UsersTable({
  users,
  currentUserId,
  busyId,
  onChangeRole,
  onDelete,
}: {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
  onDelete: (user: AdminUserRow) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-[160px]">Role</TableHead>
          <TableHead className="w-[80px]" />
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
  onDelete,
}: {
  user: AdminUserRow
  currentUserId: string
  busy: boolean
  onChangeRole: (user: AdminUserRow, nextRole: "admin" | "user") => void
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
            <AvatarImage src={user.image ?? undefined} />
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
      </TableCell>
    </TableRow>
  )
}

function normalizeRole(role: string | string[] | null | undefined): string {
  if (Array.isArray(role)) return role.includes("admin") ? "admin" : "user"
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
