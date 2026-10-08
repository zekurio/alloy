import { t, tp } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Progress } from "@alloy/ui/components/progress"
import { cn } from "@alloy/ui/lib/utils"
import {
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
} from "lucide-react"
import { memo, useState } from "react"

import { formatUsage, quotaToneClasses } from "@/components/storage-quota"
import { errorMessage } from "@/lib/error-message"
import { storageUsagePercent, storageUsageTone } from "@/lib/storage-format"
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3">
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
    </div>
  )
}

function adminUserIsBanned(user: AdminUserRow): boolean {
  return user.adminSuspendedAt === undefined
    ? user.status === "disabled"
    : user.adminSuspendedAt !== null
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
  const isBanned = adminUserIsBanned(user)
  const name = displayName(user)
  const avatar = userAvatar(user)
  const tone = quotaToneClasses(
    storageUsageTone(user.storageUsedBytes, user.storageQuotaBytes),
  )

  return (
    <Card className="flex-row items-center gap-4 p-4">
      <div className="bg-surface-sunken size-16 shrink-0 overflow-hidden rounded-md">
        {avatar.src ? (
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
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold" title={name}>
            {name}
          </span>
          {isDisabled ? (
            <Badge variant="danger" size="text" className="shrink-0">
              {isBanned ? t("Banned") : t("Disabled")}
            </Badge>
          ) : null}
        </div>
        <div
          className="text-foreground-muted truncate text-sm"
          title={user.username}
        >
          {user.username}
        </div>
        <div className="text-foreground-faint mt-1 flex items-center justify-between gap-2 text-xs tabular-nums">
          <span className="shrink-0">
            {user.clipCount} {tp(user.clipCount, "clip", "clips")}
          </span>
          <span className={cn("truncate transition-colors", tone.text)}>
            {formatUsage(user.storageUsedBytes, user.storageQuotaBytes)}
          </span>
        </div>
        {user.storageQuotaBytes === null ? null : (
          <Progress
            className="mt-1.5"
            value={storageUsagePercent(
              user.storageUsedBytes,
              user.storageQuotaBytes,
            )}
            indicatorClassName={tone.indicator}
            aria-label={t("Storage")}
          />
        )}
      </div>
      <div className="shrink-0">
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
              {isBanned ? <UserCheckIcon /> : <UserXIcon />}
              {isBanned ? t("Unban user") : t("Ban user")}
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
      </div>
    </Card>
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
  const isBanned = adminUserIsBanned(user)
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
    <ConfirmActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isBanned
          ? t("Unban {username}?", { username: user.username })
          : t("Ban {username}?", { username: user.username })
      }
      description={
        isBanned
          ? t(
              "They'll be able to sign in and their clips will be visible again.",
            )
          : t(
              "They won't be able to sign in and their clips will be hidden. Their data is kept and you can unban them later.",
            )
      }
      confirmLabel={isBanned ? t("Unban") : t("Ban")}
      pendingLabel={isBanned ? t("Unban") : t("Ban")}
      pending={busy}
      error={error}
      confirmVariant={isBanned ? "primary" : "destructive"}
      onConfirm={() => void handleToggleStatus()}
    />
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
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Delete {username}?", { username: user.username })}
      description={t(
        "This removes their sessions and clips. It can't be undone.",
      )}
      confirmLabel={t("Delete")}
      pendingLabel={t("Deleting…")}
      pending={busy}
      error={error}
      onConfirm={() => void handleDelete()}
    />
  )
}
