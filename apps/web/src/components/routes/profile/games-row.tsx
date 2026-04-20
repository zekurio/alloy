import type { ReactNode } from "react"

type GamesRowProps = {
  children: ReactNode
}

export function GamesRow({ children }: GamesRowProps) {
  return (
    <div className="-mx-8 overflow-x-auto px-8 pb-2">
      <div className="flex snap-x snap-mandatory gap-6">{children}</div>
    </div>
  )
}
