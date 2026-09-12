import { t } from "@alloy/i18n"
import {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
  AppSidebarItemTooltip,
} from "@alloy/ui/components/app-sidebar"
import { TooltipProvider } from "@alloy/ui/components/tooltip"
import { Link } from "@tanstack/react-router"
import {
  GamepadIcon,
  ClapperboardIcon,
  LibraryIcon,
  ImageIcon,
} from "lucide-react"
import { Suspense } from "react"
import type { ComponentProps, ReactNode } from "react"

import { DesktopRecordingStatus } from "./desktop-recording-status"
import { DesktopUpdatePill } from "./desktop-update-pill"
import { useNavFlags } from "./use-nav-flags"

/**
 * Permanent icon-only navigation rail. Labels live in tooltips; the user menu
 * moved to the header, so the rail only carries navigation plus the
 * account activity alongside device-local status controls.
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
        <AppSidebarGroup className="mt-auto">
          <DesktopRecordingStatus />
          <DesktopUpdatePill />
        </AppSidebarGroup>
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
        label={t("Clips")}
        render={<Link to="/" />}
      >
        <ClapperboardIcon />
      </SidebarNavItem>
      <SidebarNavItem
        active={flags.isScreenshots}
        label={t("Screenshots")}
        render={<Link to="/screenshots" />}
      >
        <ImageIcon />
      </SidebarNavItem>
      <SidebarNavItem
        active={flags.isGames}
        label={t("Games")}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </SidebarNavItem>
      <SidebarNavItem
        active={flags.isLibrary}
        label={t("Library")}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
      </SidebarNavItem>
    </>
  )
}

function SidebarNavFallback() {
  return (
    <>
      <SidebarNavItem label={t("Clips")}>
        <ClapperboardIcon />
      </SidebarNavItem>
      <SidebarNavItem label={t("Screenshots")}>
        <ImageIcon />
      </SidebarNavItem>
      <SidebarNavItem label={t("Games")}>
        <GamepadIcon />
      </SidebarNavItem>
      <SidebarNavItem label={t("Library")}>
        <LibraryIcon />
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
    <AppSidebarItemTooltip
      label={label}
      render={
        <AppSidebarItem active={active} aria-label={label} render={render}>
          {children}
        </AppSidebarItem>
      }
    />
  )
}
