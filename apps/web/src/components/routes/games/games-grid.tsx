import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

type GamesGridProps = {
  children: ReactNode
}

export function GamesGrid({ children }: GamesGridProps) {
  return (
    <div
      className={cn(
        // Match the `ClipGrid` cadence so a game card and a clip card
        // feel like the same object on screens that host both.
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]",
        "xl:[grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]"
      )}
    >
      {children}
    </div>
  )
}
