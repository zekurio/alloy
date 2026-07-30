import { t } from "@alloy/i18n"
import {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
} from "@alloy/ui/components/app-sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { Link } from "@tanstack/react-router"
import { GamepadIcon, HomeIcon, LibraryIcon } from "lucide-react"
import { Suspense } from "react"
import type { ComponentProps, ReactNode } from "react"

import { DesktopRecordingStatus } from "./desktop-recording-status"
import { DesktopUpdatePill } from "./desktop-update-pill"
import { useNavFlags } from "./use-nav-flags"

/**
 * Permanent icon-only navigation rail. Labels live in tooltips; the user menu
 * moved to the header, so the rail only carries navigation plus the
 * device-local capture/update cluster at the bottom.
 */
export function HomeSidebar() {
  return (
    <AppSidebar className="hidden md:flex">
      <TooltipProvider delay={300}>
        <AppSidebarGroup>
          <Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav />
          </Suspense>
        </AppSidebarGroup>
        <div className="mt-auto flex flex-col items-center gap-1.5 px-2">
          <DesktopRecordingStatus />
          <DesktopUpdatePill />
        </div>
      </TooltipProvider>
    </AppSidebar>
  )
}

function SidebarNav() {
  const flags = useNavFlags()

  return (
    <>
      <SidebarNavItem
        active={flags.isHome}
        label={t("Home")}
        render={<Link to="/" />}
      >
        <HomeIcon />
      </SidebarNavItem>
      <SidebarNavItem
        active={flags.isLibrary}
        label={t("Library")}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
      </SidebarNavItem>
      <SidebarNavItem
        active={flags.isGames}
        label={t("Games")}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </SidebarNavItem>
    </>
  )
}

function SidebarNavFallback() {
  return (
    <>
      <SidebarNavItem label={t("Home")}>
        <HomeIcon />
      </SidebarNavItem>
      <SidebarNavItem label={t("Library")}>
        <LibraryIcon />
      </SidebarNavItem>
      <SidebarNavItem label={t("Games")}>
        <GamepadIcon />
      </SidebarNavItem>
    </>
  )
}

function SidebarNavItem({
  active,
  label,
  render,
  children,
}: {
  active?: boolean
  label: string
  render?: ComponentProps<typeof AppSidebarItem>["render"]
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppSidebarItem active={active} aria-label={label} render={render}>
            {children}
          </AppSidebarItem>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
