import { BellIcon } from "lucide-react"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
} from "@workspace/ui/components/app-header"
import { DividerV } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"
import { UserChip } from "@workspace/ui/components/user-chip"

import { useSession } from "../lib/auth-client"
import { userChipData } from "../lib/user-display"

export function HomeHeader() {
  // `requireAuth` in the route's `beforeLoad` guarantees a session by the time
  // this component mounts, but we still subscribe via `useSession` so the chip
  // updates live if the user signs out or switches accounts in another tab.
  const { data: session } = useSession()
  const chip = userChipData(session?.user)

  return (
    <AppHeader>
      <AppHeaderBrand />
      <AppHeaderSearch />
      <AppHeaderActions>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <BellIcon />
        </Button>
        <DividerV h={20} className="mx-1" />
        <UserChip name={chip.name} avatar={chip.avatar} />
      </AppHeaderActions>
    </AppHeader>
  )
}
