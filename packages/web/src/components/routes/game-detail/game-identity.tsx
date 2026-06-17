import type { GameDetail } from "@alloy/api"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { formatCount } from "@/lib/number-format"

import { GameFavoriteButton } from "./game-favorite-button"

type GameIdentityProps = {
  game: GameDetail
  /**
   * When true a banner sits above this bar and the icon straddles the seam.
   * When false (no hero) the bar is the rounded top of the card, so the icon
   * sits inline with normal top spacing instead of overlapping upward.
   */
  hasBanner: boolean
}

function releaseYear(releaseDate: string | null): number | null {
  if (!releaseDate) return null
  const year = new Date(releaseDate).getUTCFullYear()
  return Number.isFinite(year) ? year : null
}

export function GameIdentity({ game, hasBanner }: GameIdentityProps) {
  const year = releaseYear(game.releaseDate)

  // Identity bar lives inside the frosted card body. With a hero it straddles
  // the banner edge; without one it is the rounded top of the card.
  return (
    <div className={cn(hasBanner ? "pb-4" : "pt-4 pb-4 sm:pt-5")}>
      <div
        className={cn(
          "flex gap-3 sm:gap-4",
          hasBanner ? "items-end" : "items-center",
        )}
      >
        <GameIcon
          game={game}
          className={cn(
            "!size-16 shrink-0 sm:!size-24",
            hasBanner && "-mt-10 sm:-mt-14",
          )}
        />

        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-foreground min-w-0 truncate text-xl font-semibold tracking-[-0.02em] sm:text-3xl">
              {game.name}
            </h1>

            <GameFavoriteButton
              slug={game.slug}
              viewer={game.viewer}
              className="shrink-0"
            />
          </div>

          {/* Stats mirror the profile's follower/following line — the
                favourites count lives here, not on the star button. */}
          <div className="text-foreground-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <Stat value={game.favouritesCount} label="favourites" />
            <span className="text-foreground-faint">·</span>
            <Stat
              value={game.clipCount}
              label={game.clipCount === 1 ? "clip" : "clips"}
            />
            {year !== null ? (
              <>
                <span className="text-foreground-faint">·</span>
                <span>Released {year}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A single "1,234 label" stat, count emphasised over a muted label. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-foreground font-semibold tabular-nums">
        {formatCount(value)}
      </span>
      <span>{label}</span>
    </span>
  )
}

/** Square game icon, mirroring the profile avatar that straddles the seam. */
function GameIcon({
  game,
  className,
}: {
  game: GameDetail
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)
  const iconUrl = game.iconUrl && !failed ? game.iconUrl : null

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        decoding="async"
        onError={() => setFailed(true)}
        className={cn("object-contain", className)}
      />
    )
  }

  return (
    <div
      aria-hidden
      className={cn(
        "bg-surface-raised relative overflow-hidden rounded-2xl",
        className,
      )}
    >
      <MediaPlaceholder seed={game.steamgriddbId} />
    </div>
  )
}
