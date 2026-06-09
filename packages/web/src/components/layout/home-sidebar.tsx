import { Link, useRouterState } from "@tanstack/react-router"
import {
  AppBottomNav,
  AppBottomNavItem,
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
} from "alloy-ui/components/app-sidebar"
import {
  BellIcon,
  GamepadIcon,
  HomeIcon,
  LibraryIcon,
  PlusIcon,
} from "lucide-react"
import * as React from "react"

import { NotificationCenter } from "@/components/app/notification-center"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { parseProfilePathname } from "@/lib/profile-path"
import { useSuspenseSession } from "@/lib/session-suspense"

interface NavFlags {
  isHome: boolean
  isGames: boolean
  profileHandle: string | null
}

function useNavFlags(): NavFlags {
  return useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/g/"),
      profileHandle:
        parseProfilePathname(s.location.pathname)?.username ?? null,
    }),
    structuralSharing: true,
  })
}

function isOwnProfilePath(
  routeProfileHandle: string | null,
  sessionProfileHandle: string | null,
): boolean {
  return (
    !!routeProfileHandle &&
    !!sessionProfileHandle &&
    routeProfileHandle.toLowerCase() === sessionProfileHandle.toLowerCase()
  )
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
  const { isHome, isGames, profileHandle: routeProfileHandle } = useNavFlags()
  const session = useSuspenseSession()
  const profileHandle = session?.user.username ?? null
  const isLibrary = isOwnProfilePath(routeProfileHandle, profileHandle)

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
  const { isHome, isGames, profileHandle: routeProfileHandle } = useNavFlags()
  const session = useSuspenseSession()
  const profileHandle = session?.user.username ?? null
  const isLibrary = isOwnProfilePath(routeProfileHandle, profileHandle)
  const { queueOpen, setQueueOpen } = useUploadFlowControls()

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
      {session ? (
        <AppBottomNavItem
          active={queueOpen}
          title="Upload"
          data-upload-trigger=""
          onClick={(event) => {
            event.currentTarget.blur()
            // Toggle: tapping while the queue is open closes it. The dialog
            // ignores the outside-press this same tap produces (see
            // UploadQueuePopover), so this click is the sole source of truth.
            setQueueOpen((open) => !open)
          }}
          className="before:!hidden [&_svg]:!size-4"
        >
          <NavUploadIcon />
        </AppBottomNavItem>
      ) : (
        <AppBottomNavItem
          title="Upload"
          aria-disabled
          tabIndex={-1}
          className="pointer-events-none opacity-60 before:!hidden [&_svg]:!size-4"
        >
          <NavUploadIcon />
        </AppBottomNavItem>
      )}
      <AppBottomNavItem
        active={isGames}
        title="Games"
        render={<Link to="/games" />}
      >
        <GamepadIcon />
      </AppBottomNavItem>
      <NotificationCenter variant="bottom-nav" />
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
      <AppBottomNavItem
        title="Upload"
        className="before:!hidden [&_svg]:!size-4"
      >
        <NavUploadIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title="Games">
        <GamepadIcon />
      </AppBottomNavItem>
      <AppBottomNavItem title="Notifications">
        <BellIcon />
      </AppBottomNavItem>
    </>
  )
}

function NavUploadIcon() {
  return (
    <span className="bg-accent text-accent-foreground border-accent flex size-10 items-center justify-center rounded-full border shadow-md shadow-black/35">
      <PlusIcon strokeWidth={2.5} />
    </span>
  )
}
