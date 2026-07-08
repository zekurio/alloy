import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  AtSignIcon,
  BellIcon,
  BellRingIcon,
  HeartIcon,
  MessageSquareIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties } from "react"

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
} from "@/lib/notification-queries"
import { useNotificationStream } from "@/lib/notification-stream"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"
import { userAvatar } from "@/lib/user-display"

export function NotificationBell() {
  const stream = useNotificationStream({ enabled: true })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const listQuery = useInfiniteQuery(notificationsInfiniteQueryOptions())
  const markRead = useMarkNotificationReadMutation()
  const markAllRead = useMarkAllNotificationsReadMutation()
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
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Notifications")}
            className="relative"
          />
        }
      >
        <BellIcon
          className={cn("size-4", ringing && "animate-bell-ring")}
          onAnimationEnd={() => setRinging(false)}
        />
        {unreadCount > 0 ? (
          <Badge
            key={unreadCount}
            variant="accent"
            className="animate-badge-pop absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="alloy-blur w-96 max-w-[calc(100vw-1rem)] gap-0 border p-0 ring-0"
        style={
          {
            "--alloy-blur-opacity": "90%",
            "--alloy-blur-blur": "28px",
            "--alloy-blur-shadow": "0 24px 60px -28px rgb(0 0 0 / 0.78)",
          } as CSSProperties
        }
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2.5">
          <div className="text-sm font-semibold">{t("Notifications")}</div>
          <Button
            variant="ghost"
            size="sm"
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
        <div className="max-h-[28rem] overflow-y-auto p-1.5">
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
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No notifications yet")}</EmptyTitle>
                <EmptyDescription>
                  {t("Follows, comments, likes, and mentions appear here.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
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
}

// Hearts reuse the app's liked-heart red; mentions and follows carry the
// accent since they address the viewer directly; comments stay neutral.
const KIND_ICON_CLASSES: Record<NotificationItem["kind"], string> = {
  follow: "text-accent",
  clip_like: "fill-red-500 text-red-500",
  comment_like: "fill-red-500 text-red-500",
  clip_comment: "text-foreground-muted",
  comment_reply: "text-foreground-muted",
  clip_mention: "text-accent",
  comment_mention: "text-accent",
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationItem
  onClick: () => void
}) {
  const avatar = userAvatar(item.actor)
  const parts = notificationRowParts(item)
  const KindIcon = KIND_ICONS[item.kind]
  return (
    <button
      type="button"
      className={cn(
        "flex w-full gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-raised",
        item.readAt === null && "bg-accent-soft/45",
      )}
      onClick={onClick}
    >
      <span className="relative mt-0.5 shrink-0">
        <Avatar size="md">
          <AvatarImage src={avatar.src} alt="" />
          <AvatarFallback style={{ background: avatar.bg, color: avatar.fg }}>
            {avatar.initials}
          </AvatarFallback>
        </Avatar>
        <span className="border-border bg-popover absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border">
          <KindIcon
            className={cn("size-2", KIND_ICON_CLASSES[item.kind])}
            aria-hidden
          />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5">
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
          {item.clip ? ` · ${item.clip.title}` : null}
        </span>
      </span>
      {item.readAt === null ? (
        <span className="bg-accent mt-2 size-2 shrink-0 rounded-full" />
      ) : null}
    </button>
  )
}

function NotificationListSkeleton() {
  return (
    <div aria-hidden className="space-y-1">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-2.5 px-2 py-2">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5 py-0.5">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
