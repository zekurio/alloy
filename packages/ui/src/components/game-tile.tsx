import { pastelAvatarColors, pastelMediaGradient } from "alloy-ui/lib/pastel"
import { cn } from "alloy-ui/lib/utils"
import { EyeIcon, FilmIcon } from "lucide-react"
import * as React from "react"

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
  const fallbackColors = pastelAvatarColors(name || hue)

  return (
    <article
      data-slot="game-tile"
      className={cn(
        "group/game-tile flex cursor-pointer flex-col gap-3",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "relative aspect-[3/4] overflow-hidden rounded-md bg-neutral-200",
          "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/game-tile:shadow-[0_0_0_1px_var(--accent-border)]",
        )}
      >
        {cover ? (
          <img src={cover} alt={name} className="size-full object-cover" />
        ) : (
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 grid place-items-center p-2 text-center",
              "font-mono text-sm font-semibold tracking-[0.02em]",
            )}
            style={{
              background: pastelMediaGradient(hue),
              color: fallbackColors.fg,
            }}
          >
            {name}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-foreground truncate text-sm font-semibold">
          {name}
        </div>
        {(clips !== undefined || views !== undefined) && (
          <div className="text-2xs text-foreground-faint flex items-center gap-3 leading-3 tracking-[0.04em] tabular-nums">
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
