import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "../../../lib/auth-hooks"
import { GamesSection } from "./games-section"

export function GamesPageInner() {
  const session = useRequireAuth()
  if (!session) return null

  return (
    <AppMain>
      <div className="flex w-full flex-col gap-6">
        <GamesSection />
      </div>
    </AppMain>
  )
}
