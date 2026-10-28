import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"
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

type MobileActionsRailProps = {
  clipTitle: string
  canManage: boolean
  deleting: boolean
  /** The clip can be downloaded through the browser. */
  canDownload: boolean
  /** Admin-only: queue the clip's announcement webhooks again. */
  reannounce: { onReannounce: () => void; disabled: boolean } | null
  shareState: "idle" | "pending" | "success" | "error"
  shareError: string | null
  shareDisabled: boolean
  iconSizeClassName: string
  /** Glyph colour: white over the video, the theme's text on the page. */
  iconClassName: string
  onShare: () => void
  onDownload: () => void
  onEdit: () => void
  onDelete: () => void
}

export function MobileActionsRail({
  clipTitle,
  canManage,
  deleting,
  canDownload,
  reannounce,
  shareState,
  shareError,
  shareDisabled,
  iconSizeClassName,
  iconClassName,
  onShare,
  onDownload,
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
              className={cn(iconSizeClassName, iconClassName, "animate-spin")}
            />
          ) : shareState === "success" ? (
            <CheckIcon className={cn(iconSizeClassName, "text-success")} />
          ) : shareState === "error" ? (
            <CircleAlertIcon
              className={cn(iconSizeClassName, "text-destructive")}
            />
          ) : (
            <Share2Icon className={cn(iconSizeClassName, iconClassName)} />
          )
        }
      />
      {canManage || canDownload ? (
        <Drawer direction="bottom">
          <DrawerTrigger asChild>
            <button
              type="button"
              className="flex flex-col items-center"
              aria-label={t("Clip actions")}
            >
              {/* Same colour as the rail's other glyphs; the rotation makes
                  the horizontal dots read as the usual vertical overflow menu. */}
              <MoreHorizontalIcon
                className={cn(iconSizeClassName, iconClassName, "rotate-90")}
              />
            </button>
          </DrawerTrigger>
          {/* A bottom sheet, like the share and overflow sheets of other
              phone apps: full-width rows within thumb reach instead of a small
              menu anchored to the rail. */}
          <DrawerContent className={mobileDrawerContentClass}>
            <MobileDrawerHandle />
            <DrawerTitle className="truncate px-4 pt-3 pb-2 text-base">
              {clipTitle}
            </DrawerTitle>
            <div className="flex flex-col px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {canDownload ? (
                <DrawerClose asChild>
                  <button
                    type="button"
                    className={sheetRowClass}
                    onClick={onDownload}
                  >
                    <DownloadIcon />
                    {t("Download")}
                  </button>
                </DrawerClose>
              ) : null}
              {canManage ? (
                <DrawerClose asChild>
                  <button
                    type="button"
                    className={sheetRowClass}
                    onClick={onEdit}
                  >
                    <PencilIcon />
                    {t("Edit")}
                  </button>
                </DrawerClose>
              ) : null}
              {reannounce ? (
                <DrawerClose asChild>
                  <button
                    type="button"
                    className={sheetRowClass}
                    disabled={reannounce.disabled}
                    onClick={reannounce.onReannounce}
                  >
                    <MegaphoneIcon />
                    {t("Reannounce")}
                  </button>
                </DrawerClose>
              ) : null}
              {canManage ? (
                <DrawerClose asChild>
                  <button
                    type="button"
                    className={cn(
                      sheetRowClass,
                      "text-destructive [&>svg]:text-destructive",
                    )}
                    disabled={deleting}
                    onClick={onDelete}
                  >
                    <Trash2Icon />
                    {t("Delete")}
                  </button>
                </DrawerClose>
              ) : null}
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </>
  )
}

const sheetRowClass = cn(
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-medium outline-none",
  "hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
  "[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-foreground-dim",
)
