import * as React from "react";
import { Trash2Icon, UserPlusIcon } from "lucide-react";

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
} from "@workspace/ui/components/alert-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
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
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { toast } from "@workspace/ui/components/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";

import { authClient } from "../lib/auth-client";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | string[] | null;
  banned?: boolean | null;
  createdAt: string | Date;
}

interface AdminUsersCardProps {
  /** Current admin's user id — guarded against self-deletion in the UI. */
  currentUserId: string;
}

/**
 * Admin user-management card. Wraps better-auth's admin plugin endpoints
 * (`listUsers` / `createUser` / `removeUser` / `setRole`) — every call
 * is server-validated by the plugin's own role check, this UI is the
 * convenience surface.
 *
 * "Seed user" creates an account with no password set; the user can then
 * sign in only via the configured OAuth provider, which links onto the
 * existing email (see `accountLinking` in apps/server/src/auth.ts).
 */
export function AdminUsersCard({ currentUserId }: AdminUsersCardProps) {
  const [users, setUsers] = React.useState<AdminUserRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [seedOpen, setSeedOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 100 },
      });
      if (error) throw new Error(error.message ?? "Failed to load users");
      setUsers((data?.users ?? []) as unknown as AdminUserRow[]);
      setLoadError(null);
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : "Failed to load users",
      );
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onDelete(user: AdminUserRow) {
    if (busyId) return;
    setBusyId(user.id);
    try {
      const { error } = await authClient.admin.removeUser({ userId: user.id });
      if (error) throw new Error(error.message ?? "Delete failed");
      toast.success("User removed");
      await refresh();
    } catch (cause) {
      toast.error("Couldn't remove user", {
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onChangeRole(user: AdminUserRow, nextRole: "admin" | "user") {
    const current = normalizeRole(user.role);
    if (current === nextRole) return;
    if (user.id === currentUserId && nextRole !== "admin") {
      toast.error(
        "Demote yourself from the profile page after promoting another admin first.",
      );
      return;
    }
    setBusyId(user.id);
    try {
      const { error } = await authClient.admin.setRole({
        userId: user.id,
        role: nextRole,
      });
      if (error) throw new Error(error.message ?? "Role update failed");
      toast.success(
        nextRole === "admin" ? "Promoted to admin" : "Reverted to user",
      );
      await refresh();
    } catch (cause) {
      toast.error("Couldn't update role", {
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            List, seed, and manage every account on this instance.
          </CardDescription>
        </div>
        <Dialog open={seedOpen} onOpenChange={setSeedOpen}>
          <DialogTrigger render={<Button variant="primary" size="sm" />}>
            <UserPlusIcon className="size-4" />
            Seed user
          </DialogTrigger>
          <SeedUserDialog
            onCreated={async () => {
              setSeedOpen(false);
              await refresh();
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
              {users.map((u) => {
                const role = normalizeRole(u.role);
                const isSelf = u.id === currentUserId;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-7">
                          {u.image ? <AvatarImage src={u.image} /> : null}
                          <AvatarFallback>
                            {(u.name || u.email).slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{u.name || "—"}</span>
                          {isSelf ? (
                            <Badge variant="outline" className="text-xs">
                              You
                            </Badge>
                          ) : null}
                          {u.banned ? (
                            <Badge variant="destructive" className="text-xs">
                              Banned
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground-muted">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={role}
                        onValueChange={(v) =>
                          onChangeRole(u, v as "admin" | "user")
                        }
                        disabled={busyId === u.id}
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
                              disabled={busyId === u.id || isSelf}
                            >
                              <Trash2Icon className="size-4" />
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {u.email}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes their sessions and clips. It can't be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={busyId === u.id}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => onDelete(u)}
                              disabled={busyId === u.id}
                            >
                              {busyId === u.id ? "Deleting…" : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function normalizeRole(role: string | string[] | null | undefined): string {
  if (Array.isArray(role)) return role.includes("admin") ? "admin" : "user";
  if (role === "admin") return "admin";
  return "user";
}

function SeedUserDialog({
  onCreated,
}: {
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"user" | "admin">("user");
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      // No password — better-auth's admin plugin allows this. The user can
      // only sign in via OAuth, which links onto the email we just seeded.
      const { error } = await authClient.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        role,
      });
      if (error) throw new Error(error.message ?? "Create failed");
      toast.success("User seeded", {
        description:
          "Share the OAuth login URL — they'll be linked on sign-in.",
      });
      setName("");
      setEmail("");
      setRole("user");
      await onCreated();
    } catch (cause) {
      toast.error("Couldn't seed user", {
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Seed a user</DialogTitle>
          <DialogDescription>
            Creates an account with no password. The user signs in via the
            configured OAuth provider; their identity gets linked to this email
            automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="seed-name">Name</FieldLabel>
            <Input
              id="seed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="seed-email">Email</FieldLabel>
            <Input
              id="seed-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={pending}
            />
            <FieldDescription>
              Must match the email returned by the OAuth provider for linking to
              succeed.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="seed-role">Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "user" | "admin")}
              disabled={pending}
            >
              <SelectTrigger id="seed-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
              />
            }
          >
            Cancel
          </DialogClose>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Seeding…" : "Seed user"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
