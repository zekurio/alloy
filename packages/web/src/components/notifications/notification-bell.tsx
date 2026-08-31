import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMainColumn } from "@alloy/ui/components/app-shell"
import {
  AppSidebarItem,
  AppSidebarItemTooltip,
} from "@alloy/ui/components/app-sidebar"
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
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Spinner } from "@alloy/ui/components/spinner"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cssVariables } from "@alloy/ui/lib/css-properties"
import { cn } from "@alloy/ui/lib/utils"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import {
  AtSignIcon,
  BellIcon,
  BellRingIcon,
  CheckCheckIcon,
  HeartIcon,
  MessageSquareIcon,
  Trash2Icon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { bottomLeftAppCornerAnchor } from "@/components/layout/corner-anchors"
import { formatRelativeTime } from "@/lib/date-format"
import { alloyDesktop } from "@/lib/desktop"
import {
  groupNotificationsByRecency,
  notificationRowParts,
  notificationSectionLabel,
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
  if (variant === "bottom-nav") return <BottomNavNotificationBell />
  return <NotificationPopover variant={variant} />
}

function BottomNavNotificationBell() {
  const isMobile = useIsMobile()
  const onNotificationsPage = useRouterState({
    select: (state) => state.location.pathname === "/notifications",
  })
  useNotificationStream({ enabled: isMobile && !onNotificationsPage })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const { ringing, stopRinging } = useRingingBell(unreadQuery.data)

  return (
    <Link
      to="/notifications"
      aria-label={t("Notifications")}
      title={t("Notifications")}
      className={cn(
        "active:text-accent focus-visible:ring-ring relative flex items-center justify-center px-1 outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 [&_svg]:size-[22px]",
        onNotificationsPage ? "text-accent" : "text-foreground-muted",
      )}
    >
      <NotificationIndicator
        unreadCount={unreadQuery.data ?? 0}
        ringing={ringing}
        onAnimationEnd={stopRinging}
      />
    </Link>
  )
}

function NotificationPopover({
  variant,
}: {
  variant: Exclude<NotificationBellVariant, "bottom-nav">
}) {
  const isMobile = useIsMobile()
  useNotificationStream({ enabled: !isMobile })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const markAllRead = useMarkAllNotificationsReadMutation()
  const { ringing, stopRinging } = useRingingBell(unreadQuery.data)
  const unreadCount = unreadQuery.data ?? 0
  const bell = (
    <NotificationIndicator
      variant={variant}
      unreadCount={unreadCount}
      ringing={ringing}
      onAnimationEnd={stopRinging}
    />
  )

  return (
    <Popover>
      {variant === "sidebar" ? (
        <AppSidebarItemTooltip
          label={t("Notifications")}
          render={
            <PopoverTrigger
              render={
                <AppSidebarItem
                  aria-label={t("Notifications")}
                  className="data-popup-open:text-foreground"
                />
              }
            >
              {bell}
            </PopoverTrigger>
          }
        />
      ) : (
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t("Notifications")}
              title={t("Notifications")}
              className="text-foreground hover:bg-surface-raised focus-visible:ring-ring relative flex size-8 appearance-none items-center justify-center rounded-md border-0 bg-transparent outline-none focus-visible:ring-2"
            />
          }
        >
          {bell}
        </PopoverTrigger>
      )}
      <PopoverContent
        anchor={variant === "sidebar" ? bottomLeftAppCornerAnchor : undefined}
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        sideOffset={variant === "sidebar" ? 0 : 4}
        className="alloy-blur w-[22rem] max-w-[calc(100vw-var(--sidebar-rail)-var(--app-content-padding)-var(--app-content-padding))] gap-0 overflow-hidden border p-0 ring-0"
        style={cssVariables({
          "--alloy-blur-opacity": "90%",
          "--alloy-blur-blur": "28px",
          "--alloy-blur-shadow":
            "0 24px 60px -28px var(--floating-shadow-strong-color)",
        })}
      >
        <NotificationHeader
          layout="popover"
          unreadCount={unreadCount}
          markingAllRead={markAllRead.isPending}
          onMarkAllRead={() => markAllRead.mutate()}
        />
        <NotificationContent layout="popover" />
      </PopoverContent>
    </Popover>
  )
}

export function NotificationsPage() {
  const isMobile = useIsMobile()
  useNotificationStream({ enabled: isMobile })
  const unreadQuery = useQuery(unreadCountQueryOptions())
  const markAllRead = useMarkAllNotificationsReadMutation()

  return (
    <AppMainColumn className="bg-surface max-md:pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))]">
      <NotificationHeader
        layout="page"
        unreadCount={unreadQuery.data ?? 0}
        markingAllRead={markAllRead.isPending}
        onMarkAllRead={() => markAllRead.mutate()}
      />
      <NotificationContent layout="page" />
    </AppMainColumn>
  )
}

function useRingingBell(unreadCount: number | undefined) {
  const [ringing, setRinging] = useState(false)
  const lastSeenCount = useRef<number | null>(null)
  useEffect(() => {
    if (unreadCount === undefined) return
    const prev = lastSeenCount.current
    lastSeenCount.current = unreadCount
    if (prev !== null && unreadCount > prev) setRinging(true)
  }, [unreadCount])

  return { ringing, stopRinging: () => setRinging(false) }
}

function NotificationIndicator({
  variant = "bottom-nav",
  unreadCount,
  ringing,
  onAnimationEnd,
}: {
  variant?: NotificationBellVariant
  unreadCount: number
  ringing: boolean
  onAnimationEnd: () => void
}) {
  return (
    <span className="relative">
      <BellIcon
        className={cn(
          variant === "header" ? "size-4" : "size-[22px]",
          ringing && "animate-bell-ring",
        )}
        onAnimationEnd={onAnimationEnd}
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
  )
}

function NotificationHeader({
  layout,
  unreadCount,
  markingAllRead,
  onMarkAllRead,
}: {
  layout: "page" | "popover"
  unreadCount: number
  markingAllRead: boolean
  onMarkAllRead: () => void
}) {
  const action = (
    <Button
      variant="ghost"
      size={layout === "popover" ? "icon-sm" : "icon"}
      aria-label={t("Mark all read")}
      title={t("Mark all read")}
      disabled={unreadCount === 0 || markingAllRead}
      onClick={onMarkAllRead}
    >
      <CheckCheckIcon />
    </Button>
  )

  if (layout === "popover") {
    return (
      <PopoverHeader>
        <PopoverTitle className="text-sm font-semibold">
          {t("Notifications")}
        </PopoverTitle>
        {action}
      </PopoverHeader>
    )
  }

  return (
    <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <h1 className="text-base font-semibold">{t("Notifications")}</h1>
      {action}
    </header>
  )
}

function NotificationContent({ layout }: { layout: "page" | "popover" }) {
  const listQuery = useInfiniteQuery(notificationsInfiniteQueryOptions())
  const markRead = useMarkNotificationReadMutation()
  const removeNotification = useRemoveNotificationMutation()
  const navigate = useNavigate()
  const [permission, setPermission] = useState(() =>
    globalThis.Notification ? Notification.permission : "denied",
  )
  const sentinelRef = useInfiniteScrollSentinel(
    listQuery.fetchNextPage,
    Boolean(listQuery.hasNextPage),
    listQuery.isFetchingNextPage,
  )
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? []
  const sections = useMemo(() => groupNotificationsByRecency(items), [items])
  const enableBrowserNotifications = async () => {
    if (!globalThis.Notification) return
    setPermission(await Notification.requestPermission())
  }
  return (
    <>
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
      <div
        className={cn(
          layout === "page"
            ? "min-h-0 flex-1 overflow-y-auto"
            : "max-h-[28rem] overflow-y-auto",
        )}
      >
        {listQuery.isPending ? <NotificationListSkeleton /> : null}
        {!listQuery.isPending && sections.length > 0 ? (
          <>
            {sections.map((section) => (
              <section key={section.id}>
                <h2 className="border-border/60 text-foreground-muted border-t border-b px-4 py-1.5 text-xs font-semibold tracking-wide uppercase first:border-t-0">
                  {notificationSectionLabel(section.id)}
                </h2>
                {section.items.map((item) => (
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
              </section>
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
            size={layout === "page" ? "md" : "sm"}
            fill={layout === "page"}
            title={t("No notifications yet")}
            hint={t("Activity appears here.")}
          />
        ) : null}
      </div>
    </>
  )
}

const KIND_ICONS = {
  follow: UserPlusIcon,
  clip_like: HeartIcon,
  comment_like: HeartIcon,
  clip_comment: MessageSquareIcon,
  comment_reply: MessageSquareIcon,
  clip_mention: AtSignIcon,
  comment_mention: AtSignIcon,
} satisfies Record<NotificationItem["kind"], LucideIcon>

// Hearts reuse the app's liked-heart red; mentions and follows carry the
// accent since they address the viewer directly; comments stay neutral.
const KIND_BADGE_CLASSES = {
  follow: "bg-accent text-accent-foreground",
  clip_like: "bg-red-500 text-white",
  comment_like: "bg-red-500 text-white",
  clip_comment: "bg-neutral-300 text-foreground",
  comment_reply: "bg-neutral-300 text-foreground",
  clip_mention: "bg-accent text-accent-foreground",
  comment_mention: "bg-accent text-accent-foreground",
} satisfies Record<NotificationItem["kind"], string>

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
          <span
            className={cn(
              "block text-sm leading-5 text-pretty",
              item.readAt === null && "font-medium",
            )}
          >
            {parts.before}
            <span className="font-medium">{parts.actor}</span>
            {parts.after}
          </span>
          {item.commentSnippet ? (
            <span className="text-foreground-muted line-clamp-1 text-xs">
              {item.commentSnippet}
            </span>
          ) : null}
          <span className="text-foreground-faint mt-0.5 flex items-center gap-1.5 text-xs">
            {item.readAt === null ? (
              <span
                className="bg-accent size-1.5 shrink-0 rounded-full shadow-[0_0_0_2px_var(--accent-soft)]"
                aria-hidden
              />
            ) : null}
            <span className="truncate">
              {formatRelativeTime(item.createdAt)}
              {item.clip ? ` · ${item.clip.title}` : null}
            </span>
          </span>
        </span>
        {item.readAt === null ? (
          <span className="sr-only">{t("Unread")}</span>
        ) : null}
      </button>
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
