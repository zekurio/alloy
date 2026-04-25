import { Link, useLocation } from "@tanstack/react-router"

import { TabsCount } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

type ProfileTabsNavProps = {
  username: string
  clipsCount: number | null
}

type TabSegment = "feed" | "all" | "liked" | "tagged"
type Tab = {
  segment: TabSegment
  label: string
  to:
    | "/u/$username/feed"
    | "/u/$username/all"
    | "/u/$username/liked"
    | "/u/$username/tagged"
}

const TABS: ReadonlyArray<Tab> = [
  { segment: "feed", label: "Feed", to: "/u/$username/feed" },
  { segment: "all", label: "Clips", to: "/u/$username/all" },
  { segment: "liked", label: "Liked", to: "/u/$username/liked" },
  { segment: "tagged", label: "Tagged", to: "/u/$username/tagged" },
]

export function ProfileTabsNav({ username, clipsCount }: ProfileTabsNavProps) {
  const { pathname } = useLocation()
  const base = `/u/${username}`
  // `/u/:username` with no trailing segment defaults to feed (the index
  // route redirects there, but paint the right active state immediately).
  const active =
    TABS.find((t) => pathname === `${base}/${t.segment}`)?.segment ?? "feed"

  return (
    <nav
      data-slot="tabs-list"
      data-variant="line"
      className="group/tabs-list mb-5 inline-flex w-full items-center gap-5 border-b border-border text-muted-foreground sm:mb-8"
    >
      {TABS.map((tab) => {
        const isActive = tab.segment === active
        return (
          <Link
            key={tab.segment}
            to={tab.to}
            params={{ username }}
            data-active={isActive ? "true" : undefined}
            className={cn(
              "group/tabs-trigger relative inline-flex h-8 items-center gap-2 px-0.5",
              "text-sm font-semibold whitespace-nowrap text-foreground-muted",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "outline-none focus-visible:text-foreground",
              "hover:text-foreground",
              "data-active:text-foreground",
              // Accent underline — mirrors TabsTrigger's `line` variant
              "after:absolute after:right-0 after:-bottom-px after:left-0 after:h-px after:content-['']",
              "after:bg-accent after:opacity-0",
              "after:shadow-[0_0_8px_var(--accent-glow)]",
              "data-active:after:opacity-100"
            )}
          >
            {tab.label}
            {tab.segment === "all" && clipsCount !== null ? (
              <TabsCount>{clipsCount}</TabsCount>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
