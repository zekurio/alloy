import { t } from "@alloy/i18n"
import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@alloy/ui/components/app-sidebar"
import { Link } from "@tanstack/react-router"
import { GamepadIcon, HomeIcon, LibraryIcon } from "lucide-react"
import { Suspense } from "react"

import { DesktopRecordingStatus } from "./desktop-recording-status"
import { DesktopUpdatePill } from "./desktop-update-pill"
import { useNavFlags } from "./use-nav-flags"
import { UserMenu } from "./user-menu"

export function HomeSidebar() {
  return (
    <AppSidebar className="hidden md:flex">
      <HomeSidebarContent />
    </AppSidebar>
  )
}

function HomeSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <AppSidebarGroup>
        <Suspense fallback={<SidebarTopFallback />}>
          <SidebarTop onNavigate={onNavigate} />
        </Suspense>
      </AppSidebarGroup>
      {/* Capture status sits above the footer's separator; the user menu stays
          below it. The wrapping div pins the cluster to the bottom and
          neutralizes the footer's own mt-auto. */}
      <div className="mt-auto">
        <DesktopRecordingStatus placement="sidebar" />
        <AppSidebarFooter>
          <SidebarFooter />
        </AppSidebarFooter>
      </div>
    </>
  )
}

function SidebarTop({ onNavigate }: { onNavigate?: () => void }) {
  const { isHome, isGames, isLibrary } = useNavFlags()

  return (
    <>
      <AppSidebarItem
        active={isHome}
        title={t("Home")}
        onClick={onNavigate}
        render={<Link to="/" />}
      >
        <HomeIcon />
        <span>{t("Home")}</span>
      </AppSidebarItem>
      <AppSidebarItem
        active={isLibrary}
        title={t("Library")}
        onClick={onNavigate}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
        <span>{t("Library")}</span>
      </AppSidebarItem>
      <AppSidebarItem
        active={isGames}
        title={t("Games")}
        onClick={onNavigate}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
        <span>{t("Games")}</span>
      </AppSidebarItem>
    </>
  )
}

function SidebarTopFallback() {
  return (
    <>
      <AppSidebarItem title={t("Home")}>
        <HomeIcon />
        <span>{t("Home")}</span>
      </AppSidebarItem>
      <AppSidebarItem title={t("Library")}>
        <LibraryIcon />
        <span>{t("Library")}</span>
      </AppSidebarItem>
      <AppSidebarItem title={t("Games")}>
        <GamepadIcon />
        <span>{t("Games")}</span>
      </AppSidebarItem>
    </>
  )
}

function SidebarFooter() {
  return (
    <>
      <DesktopUpdatePill />
      <UserMenu variant="rail" />
    </>
  )
}
