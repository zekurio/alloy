import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  FilmIcon,
  HeartIcon,
  MessageSquareIcon,
  PinIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"

import { clipThumbnailUrl } from "@workspace/api"
import type { NotificationRow } from "@workspace/api"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Spinner } from "@workspace/ui/components/spinner"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

import { EmptyState } from "@/components/feedback/empty-state"
import { apiOrigin } from "@/lib/env"
import { useSuspenseSession } from "@/lib/session-suspense"
import { displayName, userAvatar } from "@/lib/user-display"
import {
  notificationHref,
  notificationText,
  useClearNotificationsMutation,
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationStream,
  useNotificationsQuery,
} from "@/lib/notification-queries"

const NOTIFICATION_GLASS_STYLE = {
  "--notification-glass-opacity": "72%",
  "--notification-glass-bg":
    "color-mix(in oklab, var(--popover) var(--notification-glass-opacity), var(--background))",
  "--notification-row-glass-bg":
    "color-mix(in oklab, var(--popover) 16%, var(--background))",
  "--alloy-glass-bg": "var(--notification-glass-bg)",
  "--alloy-glass-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
} as React.CSSProperties

export function NotificationCenter() {
  const isMobile = useIsMobile()
  const session = useSuspenseSession()
  const enabled = Boolean(session)
  const [open, setOpen] = React.useState(false)
  const query = useNotificationsQuery({ enabled })
  useNotificationStream({
    enabled: enabled && query.isFetched,
    includeSnapshot: false,
  })

  if (!enabled) return null

  const unreadCount = query.data?.unreadCount ?? 0

  const trigger = (
    <Button variant="ghost" size="icon" aria-label="Notifications">
      <span className="relative inline-flex">
        <BellIcon className="size-5" />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
          />
        ) : null}
      </span>
    </Button>
  )

  const content = (
    <NotificationCenterContent
      data={query.data}
      isLoading={query.isLoading}
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
            "top-[calc(var(--header-h)+0.5rem)] right-4 left-4 z-50 w-auto max-w-none rounded-2xl border p-3",
            "max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-1.5rem)]",
            "alloy-glass"
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
          "alloy-glass"
        )}
        style={NOTIFICATION_GLASS_STYLE}
        aria-describedby={undefined}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

function NotificationCenterContent({
  data,
  isLoading,
  onClose,
}: {
  data: { items: NotificationRow[]; unreadCount: number } | undefined
  isLoading: boolean
  onClose: () => void
}) {
  const markAllRead = useMarkAllNotificationsReadMutation()
  const clearNotifications = useClearNotificationsMutation()
  const unreadCount = data?.unreadCount ?? 0
  const items = data?.items ?? []

  return (
    <section className="flex flex-col">
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        <span className="text-xs font-semibold text-foreground-muted tabular-nums">
          {unreadCount === 0 ? "all read" : `${unreadCount} unread`}
        </span>
      </header>

      <div className="-mx-1 flex max-h-[min(520px,calc(100dvh-14rem))] flex-col overflow-y-auto">
        {isLoading ? (
          <NotificationLoadingState />
        ) : items.length === 0 ? (
          <NotificationEmptyState />
        ) : (
          items.map((item, index) => (
            <NotificationRow
              key={item.id}
              item={item}
              first={index === 0}
              onClose={onClose}
            />
          ))
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-2">
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              className="text-foreground-muted"
            >
              Mark all read
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
              Clear all
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close notifications"
            onClick={onClose}
            className="text-foreground-muted"
          >
            Close
          </Button>
        </div>
      </div>
    </section>
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

  const thumbSrc =
    item.clip && item.clip.hasThumb
      ? clipThumbnailUrl(item.clip.id, apiOrigin())
      : null

  return (
    <article
      className={cn(
        "group/notification relative flex items-start gap-2.5 rounded-md px-2 py-2.5",
        "transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-raised/60",
        !first &&
          "before:pointer-events-none before:absolute before:inset-x-2 before:-top-px before:h-px before:bg-border"
      )}
    >
      <NotificationLeading item={item} unread={unread} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href ? (
          <Link
            to={href}
            className="line-clamp-2 text-sm leading-snug font-semibold tracking-[-0.01em] text-foreground hover:underline"
            onClick={handleNavigate}
          >
            {text.title}
          </Link>
        ) : (
          <span className="line-clamp-2 text-sm leading-snug font-semibold tracking-[-0.01em] text-foreground">
            {text.title}
          </span>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
          {text.body ? (
            <span className="line-clamp-1 min-w-0">{text.body}</span>
          ) : null}
          {text.body ? (
            <span aria-hidden className="text-foreground-faint">
              ·
            </span>
          ) : null}
          <span className="shrink-0 tabular-nums">
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>
      </div>

      {thumbSrc ? (
        href ? (
          <Link
            to={href}
            aria-label={text.title}
            onClick={handleNavigate}
            className="shrink-0"
          >
            <NotificationThumb src={thumbSrc} />
          </Link>
        ) : (
          <div className="shrink-0">
            <NotificationThumb src={thumbSrc} />
          </div>
        )
      ) : null}

      <div
        className={cn(
          "absolute top-1.5 right-1.5 flex shrink-0 items-center gap-0.5 rounded-md bg-surface-raised/95 p-0.5",
          "shadow-[0_4px_12px_-4px_rgb(0_0_0_/_0.35)] ring-1 ring-border",
          "opacity-0 transition-opacity duration-[var(--duration-fast)]",
          "group-hover/notification:opacity-100 focus-within:opacity-100",
          "max-sm:static max-sm:mt-0.5 max-sm:opacity-100"
        )}
      >
        {unread ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Mark as read: ${text.title}`}
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(item.id)}
          >
            <CheckIcon />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete notification: ${text.title}`}
          disabled={deleteNotification.isPending}
          onClick={() => deleteNotification.mutate(item.id)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </article>
  )
}

function NotificationThumb({ src }: { src: string }) {
  return (
    <div className="relative aspect-video w-16 overflow-hidden rounded-sm bg-surface-raised">
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
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
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-foreground-muted">
      <Icon className="size-3.5" />
    </div>
  )

  return (
    <div className="relative mt-0.5 shrink-0">
      {tile}
      {unread ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
        />
      ) : null}
    </div>
  )
}

function NotificationEmptyState() {
  return (
    <EmptyState
      className="border border-dashed border-border px-6"
      hint="New notifications will show up here."
      size="sm"
      title="Nothing here yet"
    />
  )
}

function NotificationLoadingState() {
  return (
    <div className="grid place-items-center rounded-lg border border-border px-3 py-6 text-foreground-muted">
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

function formatRelativeTime(value: string): string {
  const deltaSeconds = Math.round(
    (new Date(value).getTime() - Date.now()) / 1000
  )
  const abs = Math.abs(deltaSeconds)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

  if (abs < 60) return rtf.format(deltaSeconds, "second")
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (Math.abs(deltaMinutes) < 60) return rtf.format(deltaMinutes, "minute")
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return rtf.format(deltaHours, "hour")
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 7) return rtf.format(deltaDays, "day")
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}
