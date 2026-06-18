import { AppMain } from "@alloy/ui/components/app-shell"

import { GamesSection } from "./games-section"

export function GamesPageInner() {
  return (
    <AppMain>
      <div className="flex w-full flex-col gap-6">
        <GamesSection />
      </div>
    </AppMain>
  )
}
