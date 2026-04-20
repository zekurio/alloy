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
        "grid gap-6",
        "[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]",
        "xl:[grid-template-columns:repeat(5,minmax(0,1fr))]"
      )}
    >
      {children}
    </div>
  )
}
