import {
  clipThumbnailUrl,
  type NotificationRow,
  type NotificationsResponse,
} from "@alloy/api"
import type { DesktopUpdateState } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@alloy/ui/components/dialog"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Spinner } from "@alloy/ui/components/spinner"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  FilmIcon,
  HeartIcon,
  MessageSquareIcon,
  PinIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import {
  announceFloatingSurfaceOpen,
  type FloatingSurface,
  useFloatingSurfaceOpenListener,
} from "@/components/app/floating-surface-events"
import { EmptyState } from "@/components/feedback/empty-state"
import { formatRelativeTime } from "@/lib/date-format"
import { alloyDesktop } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import {
  notificationHref,
  notificationText,
  useClearNotificationsMutation,
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from "@/lib/notification-queries"
import { displayName, userAvatar } from "@/lib/user-display"

const NOTIFICATION_GLASS_STYLE = {
  /* Row tint stays opaque (rendered inside the blurred surface, no
     backdrop-filter of its own). The surface fill is left to the default
     `--alloy-blur-bg`, which mixes the popover hue with *transparent* so
     the backdrop blur actually has something to soften. */
  "--notification-row-glass-bg":
    "color-mix(in oklab, var(--popover) 16%, var(--background))",
  "--alloy-blur-opacity": "78%",
  "--alloy-blur-blur": "32px",
  "--alloy-blur-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
} as React.CSSProperties

type NotificationCenterProps = {
  data: NotificationsResponse | undefined
  isLoading: boolean
  menuTriggerAnchor?: Element | null
  triggerVariant?: "icon" | "menu-item"
  updateState: DesktopUpdateState
}

type MenuPopoverGeometry = {
  alignOffset: number
  maxHeight: number
  minHeight: number
}

const DEFAULT_MENU_POPOVER_GEOMETRY: MenuPopoverGeometry = {
  alignOffset: 0,
  maxHeight: 0,
  minHeight: 0,
}

export function NotificationCenter({
  data,
  isLoading,
  menuTriggerAnchor,
  triggerVariant = "icon",
  updateState,
}: NotificationCenterProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [menuPopoverGeometry, setMenuPopoverGeometry] = React.useState(
    DEFAULT_MENU_POPOVER_GEOMETRY,
  )
  const [menuPopoverAnchor, setMenuPopoverAnchor] =
    React.useState<Element | null>(null)

  const setMenuItemTrigger = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (triggerVariant !== "menu-item") return
      setMenuPopoverAnchor(
        node?.closest('[data-slot="dropdown-menu-content"]') ?? null,
      )
    },
    [triggerVariant],
  )

  const handleFloatingSurfaceOpen = React.useCallback(
    (surface: FloatingSurface) => {
      if (surface !== "notifications") setOpen(false)
    },
    [],
  )
  useFloatingSurfaceOpenListener(handleFloatingSurfaceOpen)

  React.useEffect(() => {
    if (open) announceFloatingSurfaceOpen("notifications")
  }, [open])

  React.useLayoutEffect(() => {
    if (
      !open ||
      triggerVariant !== "menu-item" ||
      !menuPopoverAnchor ||
      !menuTriggerAnchor
    ) {
      setMenuPopoverGeometry(DEFAULT_MENU_POPOVER_GEOMETRY)
      return
    }

    const updateMenuGeometry = () => {
      const popoverRect = menuPopoverAnchor.getBoundingClientRect()
      const triggerRect = menuTriggerAnchor.getBoundingClientRect()
      const viewportTop = window.visualViewport?.offsetTop ?? 0
      const viewportPadding = 8
      const maxHeight = Math.max(
        0,
        Math.round(triggerRect.bottom - viewportTop - viewportPadding),
      )
      const minHeight = Math.min(
        Math.max(0, Math.round(triggerRect.bottom - popoverRect.top)),
        maxHeight || Number.POSITIVE_INFINITY,
      )
      const nextGeometry = {
        alignOffset: Math.round(popoverRect.bottom - triggerRect.bottom),
        maxHeight,
        minHeight,
      }
      setMenuPopoverGeometry((current) =>
        isSameMenuPopoverGeometry(current, nextGeometry)
          ? current
          : nextGeometry,
      )
    }

    updateMenuGeometry()

    const resizeObserver = new ResizeObserver(updateMenuGeometry)
    resizeObserver.observe(menuPopoverAnchor)
    resizeObserver.observe(menuTriggerAnchor)
    const visualViewport = window.visualViewport
    window.addEventListener("resize", updateMenuGeometry)
    visualViewport?.addEventListener("resize", updateMenuGeometry)
    visualViewport?.addEventListener("scroll", updateMenuGeometry)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateMenuGeometry)
      visualViewport?.removeEventListener("resize", updateMenuGeometry)
      visualViewport?.removeEventListener("scroll", updateMenuGeometry)
    }
  }, [menuPopoverAnchor, menuTriggerAnchor, open, triggerVariant])

  const unreadCount = data?.unreadCount ?? 0
  const updateReady = updateState.status === "downloaded"
  const useMenuGeometry =
    triggerVariant === "menu-item" &&
    !!menuTriggerAnchor &&
    menuPopoverGeometry.minHeight > 0 &&
    menuPopoverGeometry.maxHeight > 0

  const trigger =
    triggerVariant === "menu-item" ? (
      <button
        ref={setMenuItemTrigger}
        type="button"
        className={cn(
          "relative flex h-8 w-full cursor-default items-center gap-2.5 rounded-md px-3",
          "text-sm leading-4 text-foreground-muted outline-none select-none",
          "transition-colors hover:bg-neutral-150 hover:text-foreground",
          "focus-visible:bg-neutral-150 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-foreground-dim",
        )}
        aria-label={tx("Notifications")}
      >
        <NotificationBell showDot={unreadCount > 0 || updateReady} />
        <span className="min-w-0 flex-1 text-left">{tx("Notifications")}</span>
        {unreadCount > 0 ? (
          <span className="text-foreground-faint tabular-nums">
            {unreadCount}
          </span>
        ) : null}
      </button>
    ) : (
      <Button variant="ghost" size="icon" aria-label={tx("Notifications")}>
        <NotificationBell showDot={unreadCount > 0 || updateReady} />
      </Button>
    )

  const content = (
    <NotificationCenterContent
      data={data}
      fillSurface={useMenuGeometry && !isMobile}
      isLoading={isLoading}
      mobile={isMobile}
      updateState={updateState}
      onClose={() => setOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={trigger} />
        <DialogContent
          disableZoom
          centered={false}
          className={cn(
            "inset-0 flex h-dvh w-dvw max-w-none flex-col rounded-none border-0 p-0",
            "pt-[env(safe-area-inset-top)] pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))]",
            "alloy-blur",
          )}
          style={NOTIFICATION_GLASS_STYLE}
          aria-describedby={undefined}
        >
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="end"
        alignOffset={
          triggerVariant === "menu-item" ? menuPopoverGeometry.alignOffset : 0
        }
        anchor={triggerVariant === "menu-item" ? menuPopoverAnchor : undefined}
        side={triggerVariant === "menu-item" ? "right" : "bottom"}
        sideOffset={8}
        className={cn(
          "w-[380px] max-w-[calc(100vw-1.5rem)] border p-3 ring-0",
          "alloy-blur duration-0 data-open:animate-none data-closed:animate-none",
          useMenuGeometry &&
            "max-h-(--notification-menu-max-height) min-h-(--notification-menu-min-height) overflow-hidden",
        )}
        style={notificationPopoverStyle(
          useMenuGeometry ? menuPopoverGeometry : null,
        )}
        aria-describedby={undefined}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

function isSameMenuPopoverGeometry(
  current: MenuPopoverGeometry,
  next: MenuPopoverGeometry,
) {
  return (
    current.alignOffset === next.alignOffset &&
    current.maxHeight === next.maxHeight &&
    current.minHeight === next.minHeight
  )
}

function notificationPopoverStyle(
  geometry: MenuPopoverGeometry | null,
): React.CSSProperties {
  if (!geometry) return NOTIFICATION_GLASS_STYLE

  return {
    ...NOTIFICATION_GLASS_STYLE,
    "--notification-menu-max-height": `${geometry.maxHeight}px`,
    "--notification-menu-min-height": `${geometry.minHeight}px`,
  } as React.CSSProperties
}

function NotificationBell({ showDot }: { showDot: boolean }) {
  return (
    <span className="relative inline-flex">
      <BellIcon className="size-5" />
      {showDot ? (
        <span
          aria-hidden
          className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full"
        />
      ) : null}
    </span>
  )
}

function NotificationCenterContent({
  data,
  fillSurface = false,
  isLoading,
  mobile = false,
  updateState,
  onClose,
}: {
  data: { items: NotificationRow[]; unreadCount: number } | undefined
  fillSurface?: boolean
  isLoading: boolean
  mobile?: boolean
  updateState: DesktopUpdateState
  onClose: () => void
}) {
  const markAllRead = useMarkAllNotificationsReadMutation()
  const clearNotifications = useClearNotificationsMutation()
  const unreadCount = data?.unreadCount ?? 0
  const items = data?.items ?? []
  const updateReady = updateState.status === "downloaded"

  return (
    <section
      className={cn(
        "flex flex-col",
        mobile || fillSurface ? "min-h-0 flex-1" : undefined,
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between",
          mobile
            ? "border-border/70 h-14 shrink-0 gap-2 border-b px-3"
            : "mb-2 px-1",
        )}
      >
        {mobile ? (
          <DialogClose
            aria-label={tx("Close notifications")}
            className={cn(
              "text-foreground-muted hover:bg-surface-raised hover:text-foreground",
              "focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md",
              "transition-colors focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <XIcon className="size-4" />
          </DialogClose>
        ) : null}

        {mobile ? (
          <DialogTitle className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">
            {tx("Notifications")}
          </DialogTitle>
        ) : (
          <h2 className="text-foreground text-sm font-semibold">
            {tx("Notifications")}
          </h2>
        )}

        {mobile && unreadCount > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={tx("Mark all read")}
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            className="text-foreground-muted size-9"
          >
            <CheckIcon className="size-4" />
          </Button>
        ) : (
          <span className="text-foreground-muted shrink-0 px-2 text-xs font-semibold tabular-nums">
            {unreadCount === 0
              ? tx("all read")
              : tx("{count} unread", { count: unreadCount })}
          </span>
        )}
      </header>

      <div
        className={cn(
          "flex flex-col overflow-y-auto",
          mobile
            ? "min-h-0 flex-1 px-3 py-3"
            : fillSurface
              ? "-mx-1 min-h-0 flex-1"
              : "-mx-1 max-h-[min(520px,calc(100dvh-14rem))]",
        )}
      >
        {updateReady ? (
          <DesktopUpdateRow version={updateState.version} />
        ) : null}
        {isLoading ? (
          <NotificationLoadingState mobile={mobile} />
        ) : items.length === 0 ? (
          updateReady ? null : (
            <NotificationEmptyState mobile={mobile} />
          )
        ) : (
          items.map((item, index) => (
            <NotificationRow
              key={item.id}
              item={item}
              first={index === 0 && !updateReady}
              onClose={onClose}
            />
          ))
        )}
      </div>

      {!mobile || items.length > 0 ? (
        <div
          className={cn(
            "border-border flex justify-end border-t",
            mobile ? "shrink-0 px-3 py-2" : "pt-2",
          )}
        >
          <div className="flex items-center gap-2">
            {unreadCount > 0 && !mobile ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
                className="text-foreground-muted"
              >
                {tx("Mark all read")}
              </Button>
            ) : null}
            {items.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={clearNotifications.isPending}
                onClick={() => clearNotifications.mutate()}
                className="text-foreground-muted"
              >
                {tx("Clear all")}
              </Button>
            ) : null}
            {!mobile ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={tx("Close notifications")}
                onClick={onClose}
                className="text-foreground-muted"
              >
                {tx("Close")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Device-local "update ready" entry, pinned above the server notifications.
 * Only rendered inside the desktop shell once an update has been downloaded;
 * restarting hands off to the installer and relaunches the new version.
 */
function DesktopUpdateRow({ version }: { version: string | null }) {
  const [pending, setPending] = React.useState(false)

  const restart = () => {
    const updates = alloyDesktop()?.updates
    if (!updates) return
    setPending(true)
    void updates.restartToInstall().catch(() => {
      setPending(false)
    })
  }

  return (
    <article className="group/notification relative flex items-start gap-2.5 rounded-md px-2 py-2.5">
      <div className="relative mt-0.5 shrink-0">
        <div className="border-border bg-surface-raised text-foreground-muted flex size-7 shrink-0 items-center justify-center rounded-md border">
          <RefreshCwIcon className="size-3.5" />
        </div>
        <span
          aria-hidden
          className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-foreground line-clamp-2 text-sm leading-snug font-semibold tracking-[-0.01em]">
          {tx("Update ready")}
        </span>
        <span className="text-foreground-muted text-xs">
          {version
            ? tx("Alloy {version} has been downloaded.", { version })
            : tx("A new version has been downloaded.")}
        </span>
        <div className="mt-1">
          <Button size="sm" disabled={pending} onClick={restart}>
            {pending ? tx("Restarting…") : tx("Restart to update")}
          </Button>
        </div>
      </div>
    </article>
  )
}

function NotificationRow({
  item,
  first,
  onClose,
}: {
  item: NotificationRow
  first: boolean
  onClose: () => void
}) {
  const text = notificationText(item)
  const href = notificationHref(item)
  const unread = item.readAt === null
  const markRead = useMarkNotificationReadMutation()
  const deleteNotification = useDeleteNotificationMutation()

  const handleNavigate = () => {
    if (unread) markRead.mutate(item.id)
    onClose()
  }

  const thumbSrc = item.clip?.hasThumb
    ? clipThumbnailUrl(item.clip.id, apiOrigin(), item.clip.updatedAt)
    : null

  return (
    <article
      className={cn(
        "group/notification relative flex items-start gap-2.5 rounded-md px-2 py-2.5",
        "transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-raised/60",
        !first &&
          "before:pointer-events-none before:absolute before:inset-x-2 before:-top-px before:h-px before:bg-border",
      )}
    >
      <NotificationLeading item={item} unread={unread} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href ? (
          <Link
            to={href}
            className="text-foreground line-clamp-2 text-sm leading-snug font-semibold tracking-[-0.01em] hover:underline"
            onClick={handleNavigate}
          >
            {text.title}
          </Link>
        ) : (
          <span className="text-foreground line-clamp-2 text-sm leading-snug font-semibold tracking-[-0.01em]">
            {text.title}
          </span>
        )}
        <div className="text-foreground-muted flex min-w-0 items-center gap-1.5 text-xs">
          {text.body ? (
            <span className="line-clamp-1 min-w-0">{text.body}</span>
          ) : null}
          {text.body ? (
            <span aria-hidden className="text-foreground-faint">
              {"·"}
            </span>
          ) : null}
          <span className="shrink-0 tabular-nums">
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>
      </div>

      {item.clip ? (
        href ? (
          <Link
            to={href}
            aria-label={text.title}
            onClick={handleNavigate}
            className="shrink-0"
          >
            <NotificationThumb
              src={thumbSrc}
              blurHash={item.clip.thumbBlurHash}
              seed={item.clip.gameSlug ?? item.clip.id}
            />
          </Link>
        ) : (
          <div className="shrink-0">
            <NotificationThumb
              src={thumbSrc}
              blurHash={item.clip.thumbBlurHash}
              seed={item.clip.gameSlug ?? item.clip.id}
            />
          </div>
        )
      ) : null}

      <div
        className={cn(
          "absolute top-1.5 right-1.5 flex shrink-0 items-center gap-0.5 rounded-md bg-surface-raised/95 p-0.5",
          "shadow-[0_4px_12px_-4px_rgb(0_0_0_/_0.35)] ring-1 ring-border",
          "opacity-0 transition-opacity duration-[var(--duration-fast)]",
          "group-hover/notification:opacity-100 focus-within:opacity-100",
          "max-sm:static max-sm:mt-0.5 max-sm:opacity-100",
        )}
      >
        {unread ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tx("Mark as read: {title}", { title: text.title })}
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(item.id)}
          >
            <CheckIcon />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tx("Delete notification: {title}", {
            title: text.title,
          })}
          disabled={deleteNotification.isPending}
          onClick={() => deleteNotification.mutate(item.id)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </article>
  )
}

function NotificationThumb({
  src,
  blurHash,
  seed,
}: {
  src: string | null
  blurHash: string | null
  seed: string | number
}) {
  return (
    <div
      className={cn(
        CLIP_MEDIA_VIEWPORT_CLASS,
        "w-16 rounded-sm bg-surface-raised",
      )}
    >
      <MediaPlaceholder seed={seed} blurHash={blurHash} />
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={CLIP_MEDIA_CLASS}
        />
      ) : null}
    </div>
  )
}

function NotificationLeading({
  item,
  unread,
}: {
  item: NotificationRow
  unread: boolean
}) {
  const Icon = ICON_BY_KIND[item.type]

  const tile = item.actor ? (
    (() => {
      const name = displayName(item.actor)
      const avatar = userAvatar(item.actor)
      return (
        <Avatar
          size="md"
          className="shrink-0"
          style={{ background: avatar.bg, color: avatar.fg }}
        >
          {avatar.src ? <AvatarImage src={avatar.src} alt={name} /> : null}
          <AvatarFallback style={{ background: avatar.bg, color: avatar.fg }}>
            {avatar.initials}
          </AvatarFallback>
        </Avatar>
      )
    })()
  ) : (
    <div className="border-border bg-surface-raised text-foreground-muted flex size-7 shrink-0 items-center justify-center rounded-md border">
      <Icon className="size-3.5" />
    </div>
  )

  return (
    <div className="relative mt-0.5 shrink-0">
      {tile}
      {unread ? (
        <span
          aria-hidden
          className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full"
        />
      ) : null}
    </div>
  )
}

function NotificationEmptyState({ mobile = false }: { mobile?: boolean }) {
  return (
    <EmptyState
      className={cn(
        "px-6",
        mobile
          ? "min-h-[42dvh] border-0"
          : "border-border border border-dashed",
      )}
      hint={tx("New notifications will show up here.")}
      size="sm"
      title={tx("Nothing here yet")}
    />
  )
}

function NotificationLoadingState({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={cn(
        "text-foreground-muted grid place-items-center px-3 py-6",
        mobile ? "min-h-[42dvh]" : "border-border rounded-lg border",
      )}
    >
      <Spinner />
    </div>
  )
}

const ICON_BY_KIND = {
  clip_upload_failed: CircleAlertIcon,
  new_follower: UserPlusIcon,
  new_video: FilmIcon,
  clip_comment: MessageSquareIcon,
  comment_reply: MessageSquareIcon,
  comment_pinned: PinIcon,
  comment_liked_by_author: HeartIcon,
} as const
