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
import { List, ListItem } from "@alloy/ui/components/list"
import { Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import { memo } from "react"

import { formatBytes } from "@/lib/storage-format"
import { displayName, userAvatar } from "@/lib/user-display"

import type { AdminUserEditableFields, AdminUserRow } from "./admin-user-data"
import { EditUserDialog } from "./admin-user-dialogs"

interface UsersListProps {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onUpdate: (
    user: AdminUserRow,
    next: AdminUserEditableFields,
  ) => Promise<boolean>
  onToggleStatus: (user: AdminUserRow) => void
  onDelete: (user: AdminUserRow) => void
}

export function UsersList({
  users,
  currentUserId,
  busyId,
  onUpdate,
  onToggleStatus,
  onDelete,
}: UsersListProps) {
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
        <ToggleUserStatusDialog
          user={user}
          busy={busy}
          isSelf={isSelf}
          onToggleStatus={onToggleStatus}
        />
        <DeleteUserDialog
          user={user}
          busy={busy}
          isSelf={isSelf}
          onDelete={onDelete}
        />
      </div>
    </ListItem>
  )
})

function ToggleUserStatusDialog({
  user,
  busy,
  isSelf,
  onToggleStatus,
}: {
  user: AdminUserRow
  busy: boolean
  isSelf: boolean
  onToggleStatus: (user: AdminUserRow) => void
}) {
  const isDisabled = user.status === "disabled"

  return (
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
          <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
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
  )
}

function DeleteUserDialog({
  user,
  busy,
  isSelf,
  onDelete,
}: {
  user: AdminUserRow
  busy: boolean
  isSelf: boolean
  onDelete: (user: AdminUserRow) => void
}) {
  return (
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
            {t("This removes their sessions and clips. It can't be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
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
  )
}
