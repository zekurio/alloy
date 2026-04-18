import { GamepadIcon, HomeIcon, LibraryIcon } from "lucide-react"

import {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
} from "@workspace/ui/components/app-sidebar"

export function HomeSidebar() {
  return (
    <AppSidebar>
      <AppSidebarGroup>
        <AppSidebarItem active title="Home">
          <HomeIcon />
        </AppSidebarItem>
        <AppSidebarItem title="Library">
          <LibraryIcon />
        </AppSidebarItem>
        <AppSidebarItem title="Games">
          <GamepadIcon />
        </AppSidebarItem>
      </AppSidebarGroup>
    </AppSidebar>
  )
}
