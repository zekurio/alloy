import * as React from "react"
import { EyeIcon, FilmIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

interface GameTileProps extends React.ComponentProps<"article"> {
  name: string
  clips?: string | number
  views?: string | number
  hue?: number
  cover?: string
}

function GameTile({
  className,
  name,
  clips,
  views,
  hue = 240,
  cover,
  ...props
}: GameTileProps) {
  return (
    <article
      data-slot="game-tile"
      className={cn(
        "group/game-tile flex cursor-pointer flex-col gap-3",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "relative aspect-[3/4] overflow-hidden rounded-md bg-neutral-200",
          "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/game-tile:shadow-[0_0_0_1px_var(--accent-border)]"
        )}
      >
        {cover ? (
          <img src={cover} alt={name} className="size-full object-cover" />
        ) : (
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 grid place-items-center p-2 text-center",
              "font-mono text-sm font-semibold tracking-[0.02em]"
            )}
            style={{
              background: `radial-gradient(120% 80% at 30% 20%, oklch(0.32 0.14 ${hue}), oklch(0.08 0.04 ${hue}))`,
              color: `oklch(0.85 0.1 ${hue})`,
            }}
          >
            {name}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {name}
        </div>
        {(clips !== undefined || views !== undefined) && (
          <div className="flex items-center gap-3 font-mono text-2xs tracking-[0.04em] text-foreground-faint">
            {clips !== undefined && (
              <span className="inline-flex items-center gap-1">
                <FilmIcon className="size-2.5" />
                {clips}
              </span>
            )}
            {views !== undefined && (
              <span className="inline-flex items-center gap-1">
                <EyeIcon className="size-2.5" />
                {views}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

export { GameTile, type GameTileProps }
