import { clipThumbnailUrl, type NotificationRow } from "@alloy/api"
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
  DialogContent,
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
import { useDesktopUpdateState } from "@/lib/desktop-updates"
import { apiOrigin } from "@/lib/env"
import {
  notificationHref,
  notificationText,
  useClearNotificationsMutation,
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
  useNotificationStream,
} from "@/lib/notification-queries"
import { useSuspenseSession } from "@/lib/session-suspense"
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

export function NotificationCenter() {
  const isMobile = useIsMobile()
  const session = useSuspenseSession()
  const enabled = Boolean(session)
  const [open, setOpen] = React.useState(false)
  const query = useNotificationsQuery({ enabled: false })
  useNotificationStream({ enabled })
  const updateState = useDesktopUpdateState()

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

  if (!enabled) {
    return null
  }

  const unreadCount = query.data?.unreadCount ?? 0
  const updateReady = updateState.status === "downloaded"

  const trigger = (
    <Button variant="ghost" size="icon" aria-label={tx("Notifications")}>
      <NotificationBell showDot={unreadCount > 0 || updateReady} />
    </Button>
  )

  const content = (
    <NotificationCenterContent
      data={query.data}
      isLoading={query.data === undefined}
      updateState={updateState}
      onClose={() => setOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Dialog modal={false} open={open} onOpenChange={setOpen}>
        <DialogTrigger render={trigger} />
        <DialogContent
          disableZoom
          centered={false}
          showOverlay={false}
          className={cn(
            "top-[calc(var(--header-h)+0.5rem)] right-4 left-4",
            "z-50 w-auto max-w-none rounded-2xl border p-3",
            "max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-1.5rem)]",
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
        side="bottom"
        sideOffset={8}
        className={cn(
          "w-[380px] max-w-[calc(100vw-1.5rem)] border p-3 ring-0",
          "alloy-blur duration-0 data-open:animate-none data-closed:animate-none",
        )}
        style={NOTIFICATION_GLASS_STYLE}
        aria-describedby={undefined}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
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
  isLoading,
  updateState,
  onClose,
}: {
  data: { items: NotificationRow[]; unreadCount: number } | undefined
  isLoading: boolean
  updateState: DesktopUpdateState
  onClose: () => void
}) {
  const markAllRead = useMarkAllNotificationsReadMutation()
  const clearNotifications = useClearNotificationsMutation()
  const unreadCount = data?.unreadCount ?? 0
  const items = data?.items ?? []
  const updateReady = updateState.status === "downloaded"

  return (
    <section className="flex flex-col">
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-foreground text-sm font-semibold">
          {tx("Notifications")}
        </h2>
        <span className="text-foreground-muted text-xs font-semibold tabular-nums">
          {unreadCount === 0
            ? tx("all read")
            : tx("{count} unread", { count: unreadCount })}
        </span>
      </header>

      <div className="-mx-1 flex max-h-[min(520px,calc(100dvh-14rem))] flex-col overflow-y-auto">
        {updateReady ? (
          <DesktopUpdateRow version={updateState.version} />
        ) : null}
        {isLoading ? (
          <NotificationLoadingState />
        ) : items.length === 0 ? (
          updateReady ? null : (
            <NotificationEmptyState />
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

      <div className="border-border flex justify-end border-t pt-2">
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
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
          <Button
            variant="ghost"
            size="sm"
            aria-label={tx("Close notifications")}
            onClick={onClose}
            className="text-foreground-muted"
          >
            {tx("Close")}
          </Button>
        </div>
      </div>
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

function NotificationEmptyState() {
  return (
    <EmptyState
      className="border-border border border-dashed px-6"
      hint={tx("New notifications will show up here.")}
      size="sm"
      title={tx("Nothing here yet")}
    />
  )
}

function NotificationLoadingState() {
  return (
    <div className="border-border text-foreground-muted grid place-items-center rounded-lg border px-3 py-6">
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
