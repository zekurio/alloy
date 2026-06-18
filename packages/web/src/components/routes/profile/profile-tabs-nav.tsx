import { t as tx } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useLocation } from "@tanstack/react-router"

import { parseProfilePathname } from "@/lib/profile-path"

type ProfileTabsNavProps = {
  username: string
}

type TabSegment = "all" | "liked" | "tagged"
type Tab = {
  segment: TabSegment
  label: string
  to: "/u/$username/all" | "/u/$username/liked" | "/u/$username/tagged"
}

const TABS: ReadonlyArray<Tab> = [
  {
    segment: "all",
    label: tx("Uploads"),
    to: "/u/$username/all",
  },
  {
    segment: "liked",
    label: tx("Liked"),
    to: "/u/$username/liked",
  },
  {
    segment: "tagged",
    label: tx("Tagged"),
    to: "/u/$username/tagged",
  },
]

function activeProfileSegment(pathname: string, username: string): TabSegment {
  const parsed = parseProfilePathname(pathname)
  if (!parsed || parsed.username !== username) return "all"
  const segment = parsed.segment
  return TABS.some((tab) => tab.segment === segment)
    ? (segment as TabSegment)
    : "all"
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
      className="border-border mb-6 flex w-full gap-6 overflow-x-auto overflow-y-hidden border-b sm:mb-8 sm:gap-8"
      aria-label={tx("Profile sections")}
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
              // Underline tab: plain label, accent underline when active. The
              // -mb-px pulls the active border onto the nav's bottom rule.
              "relative -mb-px inline-flex h-10 shrink-0 items-center border-b-2 px-0.5",
              "border-transparent text-sm font-medium whitespace-nowrap text-foreground-muted",
              "transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "outline-none hover:text-foreground",
              "focus-visible:text-foreground",
              "data-active:border-accent data-active:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
