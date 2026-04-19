import { BellIcon } from "lucide-react"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
} from "@workspace/ui/components/app-header"
import { DividerV } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"

import { UserMenu } from "./user-menu"

export function HomeHeader() {
  return (
    <AppHeader>
      <AppHeaderBrand />
      <AppHeaderSearch />
      <AppHeaderActions>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <BellIcon />
        </Button>
        <DividerV h={20} className="mx-1" />
        <UserMenu />
      </AppHeaderActions>
    </AppHeader>
  )
}
