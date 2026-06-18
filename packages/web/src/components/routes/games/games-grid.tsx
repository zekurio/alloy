import { cn } from "@alloy/ui/lib/utils"
import type { ReactNode } from "react"

type GamesGridProps = {
  children: ReactNode
}

export function GamesGrid({ children }: GamesGridProps) {
  return (
    <div
      className={cn(
        // Wide banner cards: fluid columns that collapse to a single
        // full-width card on narrow viewports and fan out to a few across
        // on desktop.
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]",
        "xl:[grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]",
      )}
    >
      {children}
    </div>
  )
}
