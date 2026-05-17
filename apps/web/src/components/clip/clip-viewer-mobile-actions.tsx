import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { formatCount } from "@/lib/clip-format"
import { userAvatar } from "@/lib/user-display"

type ClipAuthorLinkProps = {
  handle: string
  avatar: ReturnType<typeof userAvatar>
  avatarStyle: React.CSSProperties
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
      <Avatar size={size} style={avatarStyle} className="rounded-full">
        {avatar.src ? <AvatarImage src={avatar.src} alt={author} /> : null}
        <AvatarFallback style={avatarStyle}>{avatar.initials}</AvatarFallback>
      </Avatar>
      <span className={textClassName}>@{handle}</span>
    </Link>
  )
}

type MobileActionButtonProps = {
  icon: React.ReactNode
  count?: number
  onClick: () => void
  disabled?: boolean
  className?: string
  countClassName?: string
  ariaLabel: string
}

function MobileActionButton({
  icon,
  count,
  onClick,
  disabled,
  className,
  countClassName,
  ariaLabel,
}: MobileActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className ?? "flex flex-col items-center gap-0.5"}
      aria-label={ariaLabel}
    >
      {icon}
      {count != null ? (
        <span className={countClassName}>{formatCount(count)}</span>
      ) : null}
    </button>
  )
}

type ClipActionsMenuProps = {
  deleting: boolean
  iconClassName: string
  onEdit: () => void
  onDelete: () => void
}

function ClipActionsMenu({
  deleting,
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
            aria-label="Clip actions"
          >
            <MoreHorizontalIcon className={iconClassName} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[150px]">
        <DropdownMenuItem onClick={onEdit}>
          <PencilIcon /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={deleting}
          onClick={onDelete}
        >
          <Trash2Icon /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type MobileActionsRailProps = {
  liked: boolean
  canLike: boolean
  canManage: boolean
  deleting: boolean
  likeCount: number
  commentCount: number
  iconSizeClassName: string
  countClassName: string
  onLike: () => void
  onComments: () => void
  onShare: () => void
  onEdit: () => void
  onDelete: () => void
}

export function MobileActionsRail({
  liked,
  canLike,
  canManage,
  deleting,
  likeCount,
  commentCount,
  iconSizeClassName,
  countClassName,
  onLike,
  onComments,
  onShare,
  onEdit,
  onDelete,
}: MobileActionsRailProps) {
  return (
    <>
      <MobileActionButton
        onClick={onLike}
        disabled={!canLike}
        className="flex flex-col items-center gap-0.5 disabled:opacity-50"
        ariaLabel={liked ? "Unlike" : "Like"}
        count={likeCount}
        countClassName={countClassName}
        icon={
          <HeartIcon
            className={cn(
              iconSizeClassName,
              liked ? "fill-red-500 text-red-500" : "text-white"
            )}
          />
        }
      />
      <MobileActionButton
        onClick={onComments}
        ariaLabel="Comments"
        count={commentCount}
        countClassName={countClassName}
        icon={
          <MessageSquareIcon className={cn(iconSizeClassName, "text-white")} />
        }
      />
      <MobileActionButton
        onClick={onShare}
        className="flex flex-col items-center"
        ariaLabel="Share"
        icon={<Share2Icon className={cn(iconSizeClassName, "text-white")} />}
      />
      {canManage ? (
        <ClipActionsMenu
          deleting={deleting}
          iconClassName={cn(iconSizeClassName, "rotate-90")}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : null}
    </>
  )
}
