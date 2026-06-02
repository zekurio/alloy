import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  GamepadIcon,
  HomeIcon,
  LibraryIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react"

import {
  AppBottomNav,
  AppBottomNavItem,
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@workspace/ui/components/app-sidebar"

import { useSuspenseSession } from "@/lib/session-suspense"
import { parseProfilePathname } from "@/lib/profile-path"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"

interface NavFlags {
  isHome: boolean
  isGames: boolean
  isSettings: boolean
  profileHandle: string | null
}

function useNavFlags(): NavFlags {
  return useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/g/"),
      isSettings:
        s.location.pathname.startsWith("/user-settings") ||
        s.location.pathname.startsWith("/settings"),
      profileHandle:
        parseProfilePathname(s.location.pathname)?.username ?? null,
    }),
    structuralSharing: true,
  })
}

function isOwnProfilePath(
  routeProfileHandle: string | null,
  sessionProfileHandle: string | null
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

function SidebarSettings() {
  const { isSettings } = useNavFlags()
  const session = useSuspenseSession()

  if (!session) {
    return (
      <AppSidebarItem
        title="Settings"
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
      title="Settings"
      render={<Link to="/user-settings" />}
    >
      <SettingsIcon />
    </AppSidebarItem>
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

function SidebarSettingsFallback() {
  return (
    <AppSidebarItem title="Settings">
      <SettingsIcon />
    </AppSidebarItem>
  )
}

function BottomNavItems() {
  const {
    isHome,
    isGames,
    isSettings,
    profileHandle: routeProfileHandle,
  } = useNavFlags()
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
          onClick={(event) => {
            event.currentTarget.blur()
            setQueueOpen(true)
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
      <AppBottomNavItem
        title="Settings"
        {...(session
          ? {
              active: isSettings,
              render: <Link to="/user-settings" />,
            }
          : {
              "aria-disabled": true,
              tabIndex: -1,
              className: "pointer-events-none opacity-60",
            })}
      >
        <SettingsIcon />
      </AppBottomNavItem>
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
      <AppBottomNavItem title="Settings">
        <SettingsIcon />
      </AppBottomNavItem>
    </>
  )
}

function NavUploadIcon() {
  return (
    <span className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <PlusIcon strokeWidth={2.5} />
    </span>
  )
}
