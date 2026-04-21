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
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@workspace/ui/components/app-sidebar"

import { useSuspenseSession } from "../lib/session-suspense"

export function HomeSidebar() {
  return (
    <AppSidebar>
      <AppSidebarGroup>
        <React.Suspense fallback={<TopItemsFallback />}>
          <TopItems />
        </React.Suspense>
      </AppSidebarGroup>
      <React.Suspense fallback={null}>
        <BottomItems />
      </React.Suspense>
    </AppSidebar>
  )
}

function TopItems() {
  const { isHome, isLibrary, isGames } = useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isLibrary: s.location.pathname.startsWith("/u/"),
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/g/"),
    }),
    structuralSharing: true,
  })
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

function BottomItems() {
  const session = useSuspenseSession()
  // Same narrowing as `TopItems` — only re-render when the active surface
  // actually flips between /user-settings, /admin-settings, or something else.
  const { isSettings, isAdminPage } = useRouterState({
    select: (s) => ({
      isSettings: s.location.pathname === "/user-settings",
      isAdminPage: s.location.pathname === "/admin-settings",
    }),
    structuralSharing: true,
  })
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

function TopItemsFallback() {
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
