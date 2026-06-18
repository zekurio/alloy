import { t as tx } from "@alloy/i18n"
import {
  AppBottomNav,
  AppBottomNavItem,
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@alloy/ui/components/app-sidebar"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { GamepadIcon, HomeIcon, LibraryIcon, SettingsIcon } from "lucide-react"
import * as React from "react"

import { DEFAULT_SETTINGS_SECTION } from "@/components/routes/settings/settings-categories"
import type { AppSearch } from "@/lib/app-search"
import { useSuspenseSession } from "@/lib/session-suspense"

interface NavFlags {
  isHome: boolean
  isGames: boolean
  isLibrary: boolean
  isSettings: boolean
}

function useNavFlags(): NavFlags {
  return useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/games/") ||
        s.location.pathname.startsWith("/g/"),
      isLibrary:
        s.location.pathname === "/library" ||
        s.location.pathname.startsWith("/library/"),
      isSettings: Boolean((s.location.search as AppSearch).settings),
    }),
    structuralSharing: true,
  })
}

function useOpenSettings() {
  const navigate = useNavigate()
  return React.useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: DEFAULT_SETTINGS_SECTION,
      }),
    })
  }, [navigate])
}

export function HomeSidebar() {
  return (
    <>
      <AppSidebar className="hidden md:flex">
        <AppSidebarGroup>
          <React.Suspense fallback={<SidebarTopFallback />}>
            <SidebarTop />
          </React.Suspense>
        </AppSidebarGroup>
        <AppSidebarFooter>
          <React.Suspense fallback={<SidebarSettingsFallback />}>
            <SidebarSettings />
          </React.Suspense>
        </AppSidebarFooter>
      </AppSidebar>

      <AppBottomNav className="md:hidden">
        <React.Suspense fallback={<BottomNavFallback />}>
          <BottomNavItems />
        </React.Suspense>
      </AppBottomNav>
    </>
  )
}

function SidebarTop() {
  const { isHome, isGames, isLibrary } = useNavFlags()

  return (
    <>
      <AppSidebarItem
        active={isHome}
        title={tx("Home")}
        render={<Link to="/" />}
      >
        <HomeIcon />
      </AppSidebarItem>
      <AppSidebarItem
        active={isLibrary}
        title={tx("Library")}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
      </AppSidebarItem>
      <AppSidebarItem
        active={isGames}
        title={tx("Games")}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </AppSidebarItem>
    </>
  )
}

function SidebarSettings() {
  const { isSettings } = useNavFlags()
  const session = useSuspenseSession()
  const openSettings = useOpenSettings()

  if (!session) {
    return (
      <AppSidebarItem
        title={tx("Settings")}
        aria-disabled
        tabIndex={-1}
        className="pointer-events-none opacity-60"
      >
        <SettingsIcon />
      </AppSidebarItem>
    )
  }

  return (
    <AppSidebarItem
      active={isSettings}
      title={tx("Settings")}
      onClick={openSettings}
    >
      <SettingsIcon />
    </AppSidebarItem>
  )
}

function SidebarSettingsFallback() {
  return (
    <AppSidebarItem title={tx("Settings")}>
      <SettingsIcon />
    </AppSidebarItem>
  )
}

function SidebarTopFallback() {
  return (
    <>
      <AppSidebarItem title={tx("Home")}>
        <HomeIcon />
      </AppSidebarItem>
      <AppSidebarItem title={tx("Library")}>
        <LibraryIcon />
      </AppSidebarItem>
      <AppSidebarItem title={tx("Games")}>
        <GamepadIcon />
      </AppSidebarItem>
    </>
  )
}

function BottomNavItems() {
  const { isHome, isGames, isLibrary, isSettings } = useNavFlags()
  const session = useSuspenseSession()
  const openSettings = useOpenSettings()

  return (
    <>
      <AppBottomNavItem
        active={isHome}
        title={tx("Home")}
        render={<Link to="/" />}
      >
        <HomeIcon />
      </AppBottomNavItem>
      <AppBottomNavItem
        active={isLibrary}
        title={tx("Library")}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
      </AppBottomNavItem>
      <AppBottomNavItem
        active={isGames}
        title={tx("Games")}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </AppBottomNavItem>
      {session ? (
        <AppBottomNavItem
          active={isSettings}
          title={tx("Settings")}
          onClick={openSettings}
        >
          <SettingsIcon />
        </AppBottomNavItem>
      ) : (
        <AppBottomNavItem
          title={tx("Settings")}
          aria-disabled
          tabIndex={-1}
          className="pointer-events-none opacity-60"
        >
          <SettingsIcon />
        </AppBottomNavItem>
      )}
    </>
  )
}

function BottomNavFallback() {
  return (
    <>
      <AppBottomNavItem title={tx("Home")}>
        <HomeIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title={tx("Library")}>
        <LibraryIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title={tx("Games")}>
        <GamepadIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title={tx("Settings")}>
        <SettingsIcon />
      </AppBottomNavItem>
    </>
  )
}
