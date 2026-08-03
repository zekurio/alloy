import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { GamepadIcon, HomeIcon, LibraryIcon } from "lucide-react"
import type { ReactNode } from "react"

import { NotificationBell } from "@/components/notifications/notification-bell"
import { GlobalUploadControl } from "@/components/upload/global-upload-control"
import { useSuspenseSession } from "@/lib/session-suspense"

import { useNavFlags } from "./use-nav-flags"

/**
 * Mobile primary navigation. Hidden on md+, where the sidebar rail takes over.
 * Account access lives in the header so this icon-only bar stays focused on
 * navigation, creation, and notifications.
 */
export function MobileBottomNav() {
  const { isHome, isGames, isLibrary } = useNavFlags()
  const session = useSuspenseSession()

  return (
    <nav
      aria-label={t("Primary")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-border bg-surface border-t",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div
        className={cn(
          "grid h-[var(--bottomnav-h)] items-stretch",
          session ? "grid-cols-5" : "grid-cols-3",
        )}
      >
        <BottomNavLink
          to="/"
          active={isHome}
          label={t("Home")}
          icon={<HomeIcon />}
        />
        <BottomNavLink
          to="/library"
          active={isLibrary}
          label={t("Library")}
          icon={<LibraryIcon />}
        />
        {session ? (
          <div className="flex items-center justify-center">
            <GlobalUploadControl variant="bottom-nav" />
          </div>
        ) : null}
        {session ? <NotificationBell variant="bottom-nav" /> : null}
        <BottomNavLink
          to="/games"
          active={isGames}
          label={t("Games")}
          icon={<GamepadIcon />}
        />
      </div>
    </nav>
  )
}

const tabClass = cn(
  "relative flex items-center justify-center px-1",
  "[-webkit-tap-highlight-color:transparent]",
  "text-foreground-muted",
  "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
  "active:text-accent",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "data-active:text-accent data-popup-open:text-accent",
  "[&_svg]:size-[22px]",
)

function BottomNavLink({
  to,
  active,
  label,
  icon,
}: {
  to: "/" | "/library" | "/games"
  active: boolean
  label: string
  icon: ReactNode
}) {
  return (
    <Link
      to={to}
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={tabClass}
    >
      {icon}
    </Link>
  )
}
