import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  CheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  Share2Icon,
} from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { userAvatar } from "@/lib/user-display"

import { ClipActionsMenu } from "./clip-actions-menu"

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
      <ClipActionsMenu
        trigger={
          <button
            type="button"
            className="flex flex-col items-center"
            aria-label={t("Clip actions")}
          >
            {/* Same white as the rail's other glyphs; the rotation makes the
                horizontal dots read as the usual vertical overflow menu. */}
            <MoreHorizontalIcon
              className={cn(iconSizeClassName, "rotate-90 text-white")}
            />
          </button>
        }
        canManage={canManage}
        deleting={deleting}
        downloadAction={downloadAction}
        adminActions={announcementAction}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </>
  )
}
