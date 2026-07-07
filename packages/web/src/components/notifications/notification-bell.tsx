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
  EmptyTitle,
} from "@alloy/ui/components/empty"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { cn } from "@alloy/ui/lib/utils"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { BellIcon } from "lucide-react"
import { useState } from "react"

import { formatRelativeTime } from "@/lib/date-format"
import { alloyDesktop } from "@/lib/desktop"
import {
  notificationDisplay,
  notificationTargetPath,
} from "@/lib/notification-display"
import {
  notificationsInfiniteQueryOptions,
  unreadCountQueryOptions,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from "@/lib/notification-queries"
import { useNotificationStream } from "@/lib/notification-stream"
import { userAvatar } from "@/lib/user-display"

export function NotificationBell() {
  useNotificationStream({ enabled: true })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const listQuery = useInfiniteQuery(notificationsInfiniteQueryOptions())
  const markRead = useMarkNotificationReadMutation()
  const markAllRead = useMarkAllNotificationsReadMutation()
  const navigate = useNavigate()
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
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
        <BellIcon className="size-4" />
        {unreadCount > 0 ? (
          <Badge
            variant="accent"
            className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] p-0">
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
        {alloyDesktop() === null && permission === "default" ? (
          <div className="border-border border-b px-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={enableBrowserNotifications}
            >
              {t("Enable browser notifications")}
            </Button>
          </div>
        ) : null}
        <div className="max-h-[28rem] overflow-y-auto p-1.5">
          {items.length > 0 ? (
            items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onClick={() => {
                  if (item.readAt === null) markRead.mutate(item.id)
                  navigate({ to: notificationTargetPath(item) })
                }}
              />
            ))
          ) : (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>{t("No notifications")}</EmptyTitle>
                <EmptyDescription>
                  {t("Follows, comments, likes, and mentions appear here.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationItem
  onClick: () => void
}) {
  const avatar = userAvatar(item.actor)
  const display = notificationDisplay(item)
  return (
    <button
      type="button"
      className={cn(
        "flex w-full gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-raised",
        item.readAt === null && "bg-accent-soft/45",
      )}
      onClick={onClick}
    >
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarImage src={avatar.src} alt="" />
        <AvatarFallback style={{ background: avatar.bg, color: avatar.fg }}>
          {avatar.initials}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5">{display.body}</span>
        {item.commentSnippet ? (
          <span className="text-foreground-muted line-clamp-1 text-xs">
            {item.commentSnippet}
          </span>
        ) : null}
        <span className="text-foreground-faint mt-0.5 block text-xs">
          {formatRelativeTime(item.createdAt)}
        </span>
      </span>
      {item.readAt === null ? (
        <span className="bg-accent mt-2 size-2 shrink-0 rounded-full" />
      ) : null}
    </button>
  )
}
