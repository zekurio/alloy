import { Link, useLocation } from "@tanstack/react-router"
import { cn } from "alloy-ui/lib/utils"
import { AtSignIcon, ClapperboardIcon, HeartIcon, RssIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { parseProfilePathname } from "@/lib/profile-path"

type ProfileTabsNavProps = {
  username: string
}

type TabSegment = "feed" | "all" | "liked" | "tagged"
type Tab = {
  segment: TabSegment
  label: string
  icon: LucideIcon
  to:
    | "/u/$username/feed"
    | "/u/$username/all"
    | "/u/$username/liked"
    | "/u/$username/tagged"
}

const TABS: ReadonlyArray<Tab> = [
  {
    segment: "feed",
    label: "Feed",
    icon: RssIcon,
    to: "/u/$username/feed",
  },
  {
    segment: "all",
    label: "Clips",
    icon: ClapperboardIcon,
    to: "/u/$username/all",
  },
  {
    segment: "liked",
    label: "Liked",
    icon: HeartIcon,
    to: "/u/$username/liked",
  },
  {
    segment: "tagged",
    label: "Tagged",
    icon: AtSignIcon,
    to: "/u/$username/tagged",
  },
]

function activeProfileSegment(pathname: string, username: string): TabSegment {
  const parsed = parseProfilePathname(pathname)
  if (!parsed || parsed.username !== username) return "feed"
  const segment = parsed.segment
  return TABS.some((tab) => tab.segment === segment)
    ? (segment as TabSegment)
    : "feed"
}

export function ProfileTabsNav({ username }: ProfileTabsNavProps) {
  const { pathname } = useLocation()
  // `/u/:username` with no trailing segment defaults to feed (the index
  // route redirects there, but paint the right active state immediately).
  const active = activeProfileSegment(pathname, username)

  return (
    <nav
      data-slot="tabs-list"
      data-variant="profile"
      className="border-border bg-background/60 mb-5 flex w-full justify-center gap-1.5 overflow-x-auto border-b pb-2 sm:mb-8 sm:justify-start sm:gap-2"
      aria-label="Profile sections"
    >
      {TABS.map((tab) => {
        const isActive = tab.segment === active
        const Icon = tab.icon
        return (
          <Link
            key={tab.segment}
            to={tab.to}
            params={{ username }}
            data-active={isActive ? "true" : undefined}
            className={cn(
              "inline-flex h-10 min-w-[5.5rem] shrink-0 items-center justify-center gap-2 rounded-md border px-3.5",
              "border-transparent text-sm font-medium whitespace-nowrap text-foreground-muted",
              "transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "outline-none hover:bg-surface-raised hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "data-active:border-accent-border data-active:bg-surface-raised data-active:text-foreground",
              "sm:h-11 sm:min-w-28 sm:px-4",
            )}
          >
            <Icon className="size-[15px] shrink-0 sm:size-4" aria-hidden />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
