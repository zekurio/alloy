import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "../../../lib/auth-hooks"
import { GamesSection } from "./games-section"

export function GamesPageInner() {
  useRequireAuth()

  return (
    <AppMain>
      <div className="flex w-full flex-col gap-6">
        <GamesSection />
      </div>
    </AppMain>
  )
}
