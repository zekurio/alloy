import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  CogIcon,
  GamepadIcon,
  HomeIcon,
  LibraryIcon,
  ShieldIcon,
} from "lucide-react"

import {
  AppBottomNav,
  AppBottomNavItem,
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@workspace/ui/components/app-sidebar"

import { useSuspenseSession } from "../lib/session-suspense"

interface NavFlags {
  isHome: boolean
  isLibrary: boolean
  isGames: boolean
  isSettings: boolean
  isAdminPage: boolean
}

function useNavFlags(): NavFlags {
  return useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isLibrary: s.location.pathname.startsWith("/u/"),
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/g/"),
      isSettings: s.location.pathname === "/user-settings",
      isAdminPage: s.location.pathname === "/admin-settings",
    }),
    structuralSharing: true,
  })
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
        <React.Suspense fallback={null}>
          <SidebarBottom />
        </React.Suspense>
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
  const { isHome, isLibrary, isGames } = useNavFlags()
  const session = useSuspenseSession()
  const profileHandle = session?.user.username ?? null

  return (
    <>
      <AppSidebarItem active={isHome} title="Home" render={<Link to="/" />}>
        <HomeIcon />
      </AppSidebarItem>
      {profileHandle ? (
        <AppSidebarItem
          active={isLibrary}
          title="Library"
          render={
            <Link to="/u/$username" params={{ username: profileHandle }} />
          }
        >
          <LibraryIcon />
        </AppSidebarItem>
      ) : (
        <AppSidebarItem
          title="Library"
          aria-disabled
          tabIndex={-1}
          className="pointer-events-none opacity-60"
        >
          <LibraryIcon />
        </AppSidebarItem>
      )}
      <AppSidebarItem
        active={isGames}
        title="Games"
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </AppSidebarItem>
    </>
  )
}

function SidebarBottom() {
  const session = useSuspenseSession()
  const { isSettings, isAdminPage } = useNavFlags()
  if (!session) return null

  const isAdmin = (session.user as { role?: string }).role === "admin"

  return (
    <AppSidebarFooter className="flex flex-col gap-1">
      <AppSidebarItem
        active={isSettings}
        title="Settings"
        render={<Link to="/user-settings" />}
      >
        <CogIcon />
      </AppSidebarItem>
      {isAdmin ? (
        <AppSidebarItem
          active={isAdminPage}
          title="Admin"
          render={<Link to="/admin-settings" />}
        >
          <ShieldIcon />
        </AppSidebarItem>
      ) : null}
    </AppSidebarFooter>
  )
}

function SidebarTopFallback() {
  return (
    <>
      <AppSidebarItem title="Home">
        <HomeIcon />
      </AppSidebarItem>
      <AppSidebarItem title="Library">
        <LibraryIcon />
      </AppSidebarItem>
      <AppSidebarItem title="Games">
        <GamepadIcon />
      </AppSidebarItem>
    </>
  )
}

function BottomNavItems() {
  const { isHome, isLibrary, isGames, isSettings, isAdminPage } = useNavFlags()
  const session = useSuspenseSession()
  const profileHandle = session?.user.username ?? null
  const isAdmin = Boolean(
    session && (session.user as { role?: string }).role === "admin"
  )

  return (
    <>
      <AppBottomNavItem active={isHome} title="Home" render={<Link to="/" />}>
        <HomeIcon />
      </AppBottomNavItem>
      {profileHandle ? (
        <AppBottomNavItem
          active={isLibrary}
          title="Library"
          render={
            <Link to="/u/$username" params={{ username: profileHandle }} />
          }
        >
          <LibraryIcon />
        </AppBottomNavItem>
      ) : (
        <AppBottomNavItem
          title="Library"
          aria-disabled
          tabIndex={-1}
          className="pointer-events-none opacity-60"
        >
          <LibraryIcon />
        </AppBottomNavItem>
      )}
      <AppBottomNavItem
        active={isGames}
        title="Games"
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </AppBottomNavItem>
      {session ? (
        <AppBottomNavItem
          active={isSettings}
          title="Settings"
          render={<Link to="/user-settings" />}
        >
          <CogIcon />
        </AppBottomNavItem>
      ) : null}
      {isAdmin ? (
        <AppBottomNavItem
          active={isAdminPage}
          title="Admin"
          render={<Link to="/admin-settings" />}
        >
          <ShieldIcon />
        </AppBottomNavItem>
      ) : null}
    </>
  )
}

function BottomNavFallback() {
  return (
    <>
      <AppBottomNavItem title="Home">
        <HomeIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title="Library">
        <LibraryIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title="Games">
        <GamepadIcon />
      </AppBottomNavItem>
    </>
  )
}
