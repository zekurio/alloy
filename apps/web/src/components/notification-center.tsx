import * as React from "react"
import {
  BellIcon,
  HeartIcon,
  MessageSquareIcon,
  SparklesIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"

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
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

type MockNotification = {
  id: string
  kind: "like" | "comment" | "follow" | "feature"
  title: string
  body: string
  timeLabel: string
  unread?: boolean
}

const MOCK_NOTIFICATIONS: MockNotification[] = [
  {
    id: "mock-like-1",
    kind: "like",
    title: "New clip reaction",
    body: "TODO: replace with real actor + clip title once notification payloads exist.",
    timeLabel: "2m ago",
    unread: true,
  },
  {
    id: "mock-comment-1",
    kind: "comment",
    title: "New comment",
    body: "TODO: thread comment previews into this row and deep-link to the right timestamp.",
    timeLabel: "18m ago",
    unread: true,
  },
  {
    id: "mock-follow-1",
    kind: "follow",
    title: "New follower",
    body: "TODO: swap this mock follower text for actual social graph events.",
    timeLabel: "1h ago",
  },
  {
    id: "mock-feature-1",
    kind: "feature",
    title: "Notification settings preview",
    body: "TODO: wire read state, batching, preferences, and per-type mute controls.",
    timeLabel: "Today",
  },
]

const NOTIFICATION_GLASS_STYLE = {
  "--notification-glass-opacity": "72%",
  "--notification-glass-bg":
    "color-mix(in oklab, var(--popover) var(--notification-glass-opacity), transparent)",
  "--notification-row-glass-bg":
    "color-mix(in oklab, var(--popover) 16%, transparent)",
  "--alloy-glass-bg": "var(--notification-glass-bg)",
  "--alloy-glass-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
} as React.CSSProperties

export function NotificationCenter() {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const unreadCount = MOCK_NOTIFICATIONS.filter((item) => item.unread).length

  const trigger = (
    <Button variant="ghost" size="icon-sm" aria-label="Notifications">
      <span className="relative inline-flex">
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
          />
        ) : null}
      </span>
    </Button>
  )

  const content = <NotificationCenterContent onClose={() => setOpen(false)} />

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={trigger} />
        <DialogContent
          showOverlay={false}
          disableZoom
          centered={false}
          className={cn(
            "left-4 right-4 top-[calc(var(--header-h)+0.5rem)] z-50 w-auto max-w-none rounded-2xl border p-3",
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

function NotificationCenterContent({ onClose }: { onClose: () => void }) {
  const unreadCount = MOCK_NOTIFICATIONS.filter((item) => item.unread).length

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
          <p className="text-xs font-medium text-foreground-muted">
            {unreadCount} unread
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            TODO: mark all read
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close notifications"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {MOCK_NOTIFICATIONS.map((item) => (
          <NotificationRow key={item.id} item={item} />
        ))}
      </div>

      <footer className="flex items-center justify-between border-t border-border pt-2.5">
        <p className="text-xs text-foreground-muted">
          TODO: add pagination, live polling, optimistic read state, and empty/error states.
        </p>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
          TODO: view all
        </Button>
      </footer>
    </section>
  )
}

function NotificationRow({ item }: { item: MockNotification }) {
  const Icon = ICON_BY_KIND[item.kind]

  return (
    <article
      className={cn(
        "alloy-glass relative flex items-start gap-3 rounded-xl border px-3 py-3",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong",
        item.unread && "border-accent-border/60"
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

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {item.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              {item.body}
            </p>
          </div>
          <span className="shrink-0 text-[11px] font-medium text-foreground-faint">
            {item.timeLabel}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            TODO: open
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            TODO: dismiss
          </Button>
          {item.unread ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              Unread
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

const ICON_BY_KIND = {
  like: HeartIcon,
  comment: MessageSquareIcon,
  follow: UserPlusIcon,
  feature: SparklesIcon,
} as const
