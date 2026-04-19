import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { RiAdminLine } from "@remixicon/react"
import { CogIcon, GamepadIcon, HomeIcon, LibraryIcon } from "lucide-react"

import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@workspace/ui/components/app-sidebar"

import { useSuspenseSession } from "../lib/session-suspense"

/**
 * App rail shown on every authed surface (home, library, profile, admin).
 *
 * Top group carries the main sections (Home / Library / Games); the footer
 * pins Settings and — for admins — Admin to the bottom edge so the two
 * settings surfaces are always one click away regardless of which page the
 * viewer is on. Active state is derived from the current pathname so callers
 * can drop `<HomeSidebar />` in without threading props through every page.
 *
 * The rail renders on public routes too (e.g. `/u/$username`), so each
 * section guards for the signed-out case: Library falls back to an inert
 * stub, and the footer is skipped entirely when there's no session.
 */
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
  // Subscribe only to the derived booleans we actually render with —
  // `useRouterState` with a structural selector skips re-renders when the
  // pathname changes *but* the active flags don't (e.g. navigating between
  // two settings subpages doesn't re-render the top nav).
  const { isHome, isLibrary } = useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isLibrary: s.location.pathname.startsWith("/u/"),
    }),
    structuralSharing: true,
  })
  const session = useSuspenseSession()
  // Better-auth maps `name` → the `username` DB column, so the handle shows
  // up as `user.name` on the session. Null when signed out, in which case we
  // render an inert Library item below.
  const profileHandle = session?.user.name ?? null

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
      <AppSidebarItem title="Games" aria-disabled tabIndex={-1}>
        <GamepadIcon />
      </AppSidebarItem>
    </>
  )
}

/**
 * Settings + Admin pinned to the bottom edge. Hidden for signed-out
 * visitors (public `/u/:username` etc.) so we don't dangle dead links;
 * Admin is further gated on the `admin` role.
 */
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
          <RiAdminLine />
        </AppSidebarItem>
      ) : null}
    </AppSidebarFooter>
  )
}

/**
 * Non-suspending skeleton for the rail. Rendering the icons without any
 * active state keeps the layout stable while the session atom settles —
 * once it resolves we swap in the real (possibly Link-backed) items.
 */
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
