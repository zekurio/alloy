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
} from "@alloy/ui/components/alert-dialog"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { MediaCard, MediaCardGrid } from "@alloy/ui/components/media-card"
import {
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
} from "lucide-react"
import { memo, useState } from "react"

import { errorMessage } from "@/lib/error-message"
import { formatBytes } from "@/lib/storage-format"
import { displayName, userAvatar } from "@/lib/user-display"

import type { AdminUserEditableFields, AdminUserRow } from "./admin-user-data"
import { EditUserDialog } from "./admin-user-dialogs"

interface UsersListProps {
  users: AdminUserRow[]
  currentUserId: string
  busyId: string | null
  onUpdate: (user: AdminUserRow, next: AdminUserEditableFields) => Promise<void>
  onToggleStatus: (user: AdminUserRow) => Promise<void>
  onDelete: (user: AdminUserRow) => Promise<void>
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
    <MediaCardGrid>
      {users.map((user) => (
        <UserCard
          key={user.id}
          user={user}
          currentUserId={currentUserId}
          busy={busyId === user.id}
          onUpdate={onUpdate}
          onToggleStatus={onToggleStatus}
          onDelete={onDelete}
        />
      ))}
    </MediaCardGrid>
  )
}

const UserCard = memo(function UserCard({
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
  onUpdate: (user: AdminUserRow, next: AdminUserEditableFields) => Promise<void>
  onToggleStatus: (user: AdminUserRow) => Promise<void>
  onDelete: (user: AdminUserRow) => Promise<void>
}) {
  const [openDialog, setOpenDialog] = useState<
    "edit" | "status" | "delete" | null
  >(null)
  const isSelf = user.id === currentUserId
  const isDisabled = user.status === "disabled"
  const name = displayName(user)
  const avatar = userAvatar(user)
  const storage =
    user.storageQuotaBytes === null
      ? formatBytes(user.storageUsedBytes)
      : `${formatBytes(user.storageUsedBytes)} ${t("of")} ${formatBytes(user.storageQuotaBytes)}`

  return (
    <MediaCard
      aspect="square"
      media={
        avatar.src ? (
          <img
            src={avatar.src}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            aria-hidden
            className="grid size-full place-items-center"
            style={{ background: avatar.bg, color: avatar.fg }}
          >
            <UserIcon className="size-1/2" />
          </div>
        )
      }
      badge={
        isDisabled ? (
          <Badge variant="destructive" size="text">
            {t("Disabled")}
          </Badge>
        ) : null
      }
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("User actions")}
                  disabled={busy}
                >
                  <MoreVerticalIcon className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onClick={() => setOpenDialog("edit")}>
                <PencilIcon /> {t("Edit user")}
              </DropdownMenuItem>
              {/* Locking yourself out of the instance is never the intent. */}
              <DropdownMenuItem
                disabled={isSelf}
                onClick={() => setOpenDialog("status")}
              >
                {isDisabled ? <UserCheckIcon /> : <UserXIcon />}
                {isDisabled ? t("Enable user") : t("Disable user")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={isSelf}
                onClick={() => setOpenDialog("delete")}
              >
                <Trash2Icon /> {t("Delete user")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <EditUserDialog
            user={user}
            busy={busy}
            open={openDialog === "edit"}
            onOpenChange={(next) => setOpenDialog(next ? "edit" : null)}
            onUpdate={onUpdate}
          />
          <ToggleUserStatusDialog
            user={user}
            busy={busy}
            open={openDialog === "status"}
            onOpenChange={(next) => setOpenDialog(next ? "status" : null)}
            onToggleStatus={onToggleStatus}
          />
          <DeleteUserDialog
            user={user}
            busy={busy}
            open={openDialog === "delete"}
            onOpenChange={(next) => setOpenDialog(next ? "delete" : null)}
            onDelete={onDelete}
          />
        </>
      }
      title={name}
      subtitle={user.email}
      meta={`${user.clipCount} ${tp(user.clipCount, "clip", "clips")} · ${storage}`}
    />
  )
})

function ToggleUserStatusDialog({
  user,
  busy,
  open,
  onOpenChange,
  onToggleStatus,
}: {
  user: AdminUserRow
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleStatus: (user: AdminUserRow) => Promise<void>
}) {
  const isDisabled = user.status === "disabled"
  const [error, setError] = useState<string | null>(null)

  async function handleToggleStatus() {
    setError(null)
    try {
      await onToggleStatus(user)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't update user")))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={isDisabled ? "primary" : "destructive"}
            onClick={() => void handleToggleStatus()}
            disabled={busy}
          >
            {error ? t("Try again") : isDisabled ? t("Enable") : t("Disable")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteUserDialog({
  user,
  busy,
  open,
  onOpenChange,
  onDelete,
}: {
  user: AdminUserRow
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (user: AdminUserRow) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setError(null)
    try {
      await onDelete(user)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't remove user")))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("Delete {email}?", { email: user.email })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("This removes their sessions and clips. It can't be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={busy}
          >
            {busy ? t("Deleting…") : error ? t("Try again") : t("Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
