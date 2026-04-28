import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  HeartIcon,
  MessageSquareIcon,
  PinIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"

import type { NotificationRow } from "@workspace/api"
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

import { useSuspenseSession } from "@/lib/session-suspense"
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
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        <span className="text-xs font-semibold text-foreground-muted tabular-nums">
          {unreadCount === 0 ? "all read" : `${unreadCount} unread`}
        </span>
      </header>

      <div className="flex max-h-[min(520px,calc(100dvh-14rem))] flex-col gap-2 overflow-y-auto pr-1">
        {isLoading ? (
          <NotificationLoadingState />
        ) : items.length === 0 ? (
          <NotificationEmptyState />
        ) : (
          items.map((item) => (
            <NotificationRow key={item.id} item={item} onClose={onClose} />
          ))
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-2.5">
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
  onClose,
}: {
  item: NotificationRow
  onClose: () => void
}) {
  const Icon = ICON_BY_KIND[item.type]
  const text = notificationText(item)
  const href = notificationHref(item)
  const unread = item.readAt === null
  const markRead = useMarkNotificationReadMutation()
  const deleteNotification = useDeleteNotificationMutation()

  return (
    <article
      className={cn(
        "alloy-glass relative flex items-center gap-3 rounded-md border px-3 py-2.5",
        "transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong",
        unread && "border-accent-border/60"
      )}
      style={
        {
          "--alloy-glass-bg": "var(--notification-row-glass-bg)",
          "--alloy-glass-shadow": "0 12px 32px -28px rgb(0 0 0 / 0.48)",
        } as React.CSSProperties
      }
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted">
        <Icon className="size-3.5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {href ? (
            <Link
              to={href}
              className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground hover:underline"
              onClick={() => {
                if (unread) markRead.mutate(item.id)
                onClose()
              }}
            >
              {text.title}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
              {text.title}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground-muted">
          <span className="truncate">{text.body}</span>
          <span className="shrink-0">{formatRelativeTime(item.createdAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-0.5">
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

function NotificationEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-6 py-8 text-center">
      <p className="text-sm font-medium text-foreground">Nothing here yet</p>
      <p className="text-xs font-semibold text-foreground-muted">
        New notifications will show up here.
      </p>
    </div>
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
