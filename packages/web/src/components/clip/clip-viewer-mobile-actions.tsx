import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  CheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { userAvatar } from "@/lib/user-display"

type ClipAuthorLinkProps = {
  handle: string
  avatar: ReturnType<typeof userAvatar>
  avatarStyle: CSSProperties
  author: string
  size: "sm" | "md" | "lg"
  className: string
  textClassName: string
}

export function ClipAuthorLink({
  handle,
  avatar,
  avatarStyle,
  author,
  size,
  className,
  textClassName,
}: ClipAuthorLinkProps) {
  return (
    <Link to="/u/$username" params={{ username: handle }} className={className}>
      <Avatar size={size} style={avatarStyle}>
        {avatar.src ? <AvatarImage src={avatar.src} alt={author} /> : null}
        <AvatarFallback style={avatarStyle} />
      </Avatar>
      <span className={textClassName}>{handle}</span>
    </Link>
  )
}

type MobileActionButtonProps = {
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
  ariaLabel: string
  title?: string
}

function MobileActionButton({
  icon,
  onClick,
  disabled,
  className,
  ariaLabel,
  title,
}: MobileActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className ?? "flex flex-col items-center gap-0.5"}
      aria-label={ariaLabel}
      title={title}
    >
      {icon}
    </button>
  )
}

type ClipActionsMenuProps = {
  announcementAction?: ReactNode
  canManage: boolean
  deleting: boolean
  downloadAction?: ReactNode
  iconClassName: string
  onEdit: () => void
  onDelete: () => void
}

function ClipActionsMenu({
  announcementAction,
  canManage,
  deleting,
  downloadAction,
  iconClassName,
  onEdit,
  onDelete,
}: ClipActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex flex-col items-center text-white/80"
            aria-label={t("Clip actions")}
          >
            <MoreHorizontalIcon className={iconClassName} />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="alloy-blur w-max max-w-[calc(100dvw-2rem)] min-w-56"
      >
        {downloadAction}
        {canManage && downloadAction ? <DropdownMenuSeparator /> : null}
        {canManage ? (
          <>
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon /> {t("Edit")}
            </DropdownMenuItem>
            {announcementAction}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting}
              onClick={onDelete}
            >
              <Trash2Icon /> {t("Delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type MobileActionsRailProps = {
  announcementAction?: ReactNode
  canManage: boolean
  deleting: boolean
  downloadAction?: ReactNode
  shareState: "idle" | "pending" | "success" | "error"
  shareError: string | null
  shareDisabled: boolean
  iconSizeClassName: string
  onShare: () => void
  onEdit: () => void
  onDelete: () => void
}

export function MobileActionsRail({
  announcementAction,
  canManage,
  deleting,
  downloadAction,
  shareState,
  shareError,
  shareDisabled,
  iconSizeClassName,
  onShare,
  onEdit,
  onDelete,
}: MobileActionsRailProps) {
  return (
    <>
      <MobileActionButton
        onClick={onShare}
        disabled={shareDisabled || shareState === "pending"}
        className="flex flex-col items-center"
        ariaLabel={t("Share")}
        title={
          shareDisabled ? t("Clip link is disabled") : (shareError ?? undefined)
        }
        icon={
          shareState === "pending" ? (
            <LoaderCircleIcon
              className={cn(iconSizeClassName, "animate-spin text-white")}
            />
          ) : shareState === "success" ? (
            <CheckIcon className={cn(iconSizeClassName, "text-success")} />
          ) : shareState === "error" ? (
            <CircleAlertIcon
              className={cn(iconSizeClassName, "text-destructive")}
            />
          ) : (
            <Share2Icon className={cn(iconSizeClassName, "text-white")} />
          )
        }
      />
      {canManage || downloadAction ? (
        <ClipActionsMenu
          announcementAction={announcementAction}
          canManage={canManage}
          deleting={deleting}
          downloadAction={downloadAction}
          iconClassName={cn(iconSizeClassName, "rotate-90")}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : null}
    </>
  )
}
