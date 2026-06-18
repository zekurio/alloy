import { t as tx } from "@alloy/i18n"
import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
} from "@alloy/ui/components/app-sidebar"
import { Button } from "@alloy/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
import { Link, useRouterState } from "@tanstack/react-router"
import { GamepadIcon, HomeIcon, LibraryIcon, MenuIcon } from "lucide-react"
import * as React from "react"

import { DesktopRecordingStatus } from "./desktop-recording-status"
import { UserMenu } from "./user-menu"

interface NavFlags {
  isHome: boolean
  isGames: boolean
  isLibrary: boolean
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
    }),
    structuralSharing: true,
  })
}

export function HomeSidebar() {
  return (
    <AppSidebar className="hidden md:flex">
      <HomeSidebarContent />
    </AppSidebar>
  )
}

export function MobileSidebarTrigger() {
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <Drawer direction="left" open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={tx("Open navigation")}
            className="text-foreground-faint hover:bg-surface-raised hover:text-foreground-muted size-11 rounded-md [&_svg]:size-4"
          >
            <MenuIcon />
          </Button>
        }
      />
      <DrawerContent className="border-border bg-surface-sunken w-[min(82vw,20rem)] max-w-[20rem] p-0">
        <DrawerTitle className="sr-only">{tx("Navigation")}</DrawerTitle>
        <AppSidebar className="h-full w-full border-0">
          <HomeSidebarContent onNavigate={close} />
        </AppSidebar>
      </DrawerContent>
    </Drawer>
  )
}

function HomeSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <AppSidebarGroup>
        <React.Suspense fallback={<SidebarTopFallback />}>
          <SidebarTop onNavigate={onNavigate} />
        </React.Suspense>
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
        title={tx("Home")}
        onClick={onNavigate}
        render={<Link to="/" />}
      >
        <HomeIcon />
        <span>{tx("Home")}</span>
      </AppSidebarItem>
      <AppSidebarItem
        active={isLibrary}
        title={tx("Library")}
        onClick={onNavigate}
        render={<Link to="/library" />}
      >
        <LibraryIcon />
        <span>{tx("Library")}</span>
      </AppSidebarItem>
      <AppSidebarItem
        active={isGames}
        title={tx("Games")}
        onClick={onNavigate}
        render={<Link to="/games" />}
      >
        <GamepadIcon />
        <span>{tx("Games")}</span>
      </AppSidebarItem>
    </>
  )
}

function SidebarTopFallback() {
  return (
    <>
      <AppSidebarItem title={tx("Home")}>
        <HomeIcon />
        <span>{tx("Home")}</span>
      </AppSidebarItem>
      <AppSidebarItem title={tx("Library")}>
        <LibraryIcon />
        <span>{tx("Library")}</span>
      </AppSidebarItem>
      <AppSidebarItem title={tx("Games")}>
        <GamepadIcon />
        <span>{tx("Games")}</span>
      </AppSidebarItem>
    </>
  )
}

function SidebarFooter() {
  return <UserMenu variant="rail" />
}
