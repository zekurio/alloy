import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { NumberBadge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Spinner } from "@alloy/ui/components/spinner"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cn } from "@alloy/ui/lib/utils"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  AtSignIcon,
  BellIcon,
  BellRingIcon,
  HeartIcon,
  MessageSquareIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { bottomLeftAppCornerAnchor } from "@/components/layout/corner-anchors"
import { formatRelativeTime } from "@/lib/date-format"
import { alloyDesktop } from "@/lib/desktop"
import {
  notificationRowParts,
  notificationTargetPath,
} from "@/lib/notification-display"
import {
  notificationsInfiniteQueryOptions,
  unreadCountQueryOptions,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useRemoveNotificationMutation,
} from "@/lib/notification-queries"
import { useNotificationStream } from "@/lib/notification-stream"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"
import { userAvatar } from "@/lib/user-display"

type NotificationBellVariant = "header" | "sidebar" | "bottom-nav"

export function NotificationBell({
  variant = "header",
}: {
  variant?: NotificationBellVariant
}) {
  const isMobile = useIsMobile()
  const stream = useNotificationStream({
    enabled: variant === "bottom-nav" ? isMobile : !isMobile,
  })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const listQuery = useInfiniteQuery(notificationsInfiniteQueryOptions())
  const markRead = useMarkNotificationReadMutation()
  const markAllRead = useMarkAllNotificationsReadMutation()
  const removeNotification = useRemoveNotificationMutation()
  const navigate = useNavigate()
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  )
  const [ringing, setRinging] = useState(false)
  // null until the first count arrives, so the initial fetch never rings the
  // bell — only a live increase does.
  const lastSeenCount = useRef<number | null>(null)
  useEffect(() => {
    const count = unreadQuery.data
    if (count === undefined) return
    const prev = lastSeenCount.current
    lastSeenCount.current = count
    if (prev !== null && count > prev) setRinging(true)
  }, [unreadQuery.data])
  const sentinelRef = useInfiniteScrollSentinel(
    listQuery.fetchNextPage,
    Boolean(listQuery.hasNextPage),
    listQuery.isFetchingNextPage,
  )
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? []
  const unreadCount = unreadQuery.data ?? 0
  const enableBrowserNotifications = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("Notifications")}
            title={t("Notifications")}
            className={cn(
              "relative flex appearance-none items-center justify-center border-0 bg-transparent outline-none",
              "focus-visible:ring-ring focus-visible:ring-2",
              variant === "header" &&
                "text-foreground hover:bg-surface-raised size-8 rounded-md",
              variant === "sidebar" &&
                "text-foreground-muted hover:text-foreground size-10 rounded-md transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] [&_svg]:size-6",
              variant === "bottom-nav" &&
                "text-foreground-muted active:text-accent px-1 [-webkit-tap-highlight-color:transparent] [&_svg]:size-[22px]",
            )}
          />
        }
      >
        <span className="relative">
          <BellIcon
            className={cn(
              variant === "header" ? "size-4" : "size-[22px]",
              ringing && "animate-bell-ring",
            )}
            onAnimationEnd={() => setRinging(false)}
          />
          {unreadCount > 0 ? (
            <NumberBadge
              key={unreadCount}
              className="animate-badge-pop absolute -top-2 -right-2"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </NumberBadge>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent
        anchor={variant === "sidebar" ? bottomLeftAppCornerAnchor : undefined}
        align={variant === "sidebar" ? "start" : "end"}
        side={
          variant === "sidebar"
            ? "top"
            : variant === "bottom-nav"
              ? "top"
              : "bottom"
        }
        sideOffset={variant === "sidebar" ? 0 : variant === "header" ? 4 : 8}
        className="alloy-blur w-[22rem] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden border p-0 ring-0"
        style={
          {
            "--alloy-blur-opacity": "90%",
            "--alloy-blur-blur": "28px",
            "--alloy-blur-shadow":
              "0 24px 60px -28px var(--floating-shadow-strong-color)",
          } as CSSProperties
        }
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="text-sm font-semibold">{t("Notifications")}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-0 font-medium hover:bg-transparent"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {t("Mark all read")}
          </Button>
        </div>
        {stream.initialError ? (
          <div className="text-foreground-faint border-border flex items-center gap-1.5 border-b px-3 py-1.5 text-xs">
            <Spinner className="size-3" />
            {t("Reconnecting…")}
          </div>
        ) : null}
        {alloyDesktop() === null && permission === "default" ? (
          <div className="border-border flex items-center gap-2.5 border-b px-3 py-2">
            <BellRingIcon
              className="text-foreground-faint size-3.5 shrink-0"
              aria-hidden
            />
            <span className="text-foreground-muted min-w-0 flex-1 truncate text-xs">
              {t("Browser notifications")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-accent hover:text-accent shrink-0"
              onClick={enableBrowserNotifications}
            >
              {t("Enable")}
            </Button>
          </div>
        ) : null}
        <div className="max-h-[28rem] overflow-y-auto">
          {listQuery.isPending ? <NotificationListSkeleton /> : null}
          {!listQuery.isPending && items.length > 0 ? (
            <>
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onClick={() => {
                    if (item.readAt === null) markRead.mutate(item.id)
                    navigate({ to: notificationTargetPath(item) })
                  }}
                  removing={
                    removeNotification.isPending &&
                    removeNotification.variables === item.id
                  }
                  onRemove={() => removeNotification.mutate(item.id)}
                />
              ))}
              {listQuery.hasNextPage || listQuery.isFetchingNextPage ? (
                <div ref={sentinelRef} className="flex justify-center p-2">
                  {listQuery.isFetchingNextPage ? (
                    <Spinner className="size-4" />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          {!listQuery.isPending && items.length === 0 ? (
            <EmptyState
              icon={BellIcon}
              size="sm"
              title={t("No notifications yet")}
              hint={t("Activity and upload failures appear here.")}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const KIND_ICONS: Record<NotificationItem["kind"], LucideIcon> = {
  follow: UserPlusIcon,
  clip_like: HeartIcon,
  comment_like: HeartIcon,
  clip_comment: MessageSquareIcon,
  comment_reply: MessageSquareIcon,
  clip_mention: AtSignIcon,
  comment_mention: AtSignIcon,
  clip_processing_failed: TriangleAlertIcon,
}

// Hearts reuse the app's liked-heart red; mentions and follows carry the
// accent since they address the viewer directly; comments stay neutral.
const KIND_BADGE_CLASSES: Record<NotificationItem["kind"], string> = {
  follow: "bg-accent text-accent-foreground",
  clip_like: "bg-red-500 text-white",
  comment_like: "bg-red-500 text-white",
  clip_comment: "bg-neutral-300 text-foreground",
  comment_reply: "bg-neutral-300 text-foreground",
  clip_mention: "bg-accent text-accent-foreground",
  comment_mention: "bg-accent text-accent-foreground",
  clip_processing_failed: "bg-destructive text-white",
}

function NotificationRow({
  item,
  onClick,
  removing,
  onRemove,
}: {
  item: NotificationItem
  onClick: () => void
  removing: boolean
  onRemove: () => void
}) {
  const avatar = item.actor ? userAvatar(item.actor) : null
  const parts = notificationRowParts(item)
  const KindIcon = KIND_ICONS[item.kind]
  return (
    <div
      className={cn(
        "group/notification border-border/60 relative border-b transition-colors last:border-b-0 hover:bg-surface-raised/70",
        item.readAt === null && "bg-accent-soft/15 hover:bg-accent-soft/25",
      )}
    >
      <button
        type="button"
        className="focus-visible:ring-ring flex w-full gap-3 px-4 py-3 pr-11 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onClick={onClick}
      >
        <span className="relative size-9 shrink-0">
          {avatar ? (
            <>
              <Avatar size="lg">
                <AvatarImage src={avatar.src} alt="" />
                <AvatarFallback
                  style={{ background: avatar.bg, color: avatar.fg }}
                />
              </Avatar>
              <span
                className={cn(
                  "ring-popover absolute right-0 bottom-0 flex size-4 items-center justify-center rounded-full ring-2",
                  KIND_BADGE_CLASSES[item.kind],
                )}
              >
                <KindIcon
                  className={cn(
                    "size-2.5",
                    (item.kind === "clip_like" ||
                      item.kind === "comment_like") &&
                      "fill-current",
                  )}
                  aria-hidden
                />
              </span>
            </>
          ) : (
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                KIND_BADGE_CLASSES[item.kind],
              )}
            >
              <KindIcon className="size-3.5" aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-5 text-pretty">
            {parts.before}
            <span className="font-medium">{parts.actor}</span>
            {parts.after}
          </span>
          {item.commentSnippet ? (
            <span className="text-foreground-muted line-clamp-1 text-xs">
              {item.commentSnippet}
            </span>
          ) : null}
          <span className="text-foreground-faint mt-0.5 block truncate text-xs">
            {formatRelativeTime(item.createdAt)}
            {item.clip && item.kind !== "clip_processing_failed"
              ? ` · ${item.clip.title}`
              : null}
          </span>
        </span>
        {item.readAt === null ? (
          <span className="sr-only">{t("Unread")}</span>
        ) : null}
      </button>
      {item.readAt === null ? (
        <span
          className="bg-accent pointer-events-none absolute top-1/2 right-4 size-1.5 -translate-y-1/2 rounded-full shadow-[0_0_0_3px_var(--accent-soft)] transition-opacity group-hover/notification:opacity-0"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        aria-label={t("Remove notification")}
        title={t("Remove notification")}
        disabled={removing}
        className="text-foreground-faint hover:text-destructive focus-visible:ring-ring absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md opacity-100 transition-[color,opacity] outline-none focus-visible:opacity-100 focus-visible:ring-2 disabled:pointer-events-none md:opacity-0 md:group-hover/notification:opacity-100"
        onClick={onRemove}
      >
        {removing ? (
          <Spinner className="size-3.5" />
        ) : (
          <Trash2Icon className="size-3.5" />
        )}
      </button>
    </div>
  )
}

function NotificationListSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="border-border/60 flex gap-3 border-b px-4 py-3 last:border-b-0"
        >
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5 py-0.5">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
