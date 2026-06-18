import type { GameDetail } from "@alloy/api"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"
import { formatCount } from "@/lib/number-format"

import { GameFavoriteButton } from "./game-favorite-button"

type GameHeaderProps = {
  game: GameDetail
}

function releaseYear(releaseDate: string | null): number | null {
  if (!releaseDate) return null
  const year = new Date(releaseDate).getUTCFullYear()
  return Number.isFinite(year) ? year : null
}

export function GameHeader({ game }: GameHeaderProps) {
  return (
    <header className="w-full min-w-0">
      <GameHeroBanner game={game} />
    </header>
  )
}

function GameHeroBanner({ game }: { game: GameDetail }) {
  const [failedHeaderUrls, setFailedHeaderUrls] = React.useState<
    readonly string[]
  >([])
  const [failedLogoUrl, setFailedLogoUrl] = React.useState<string | null>(null)
  const headerUrl =
    game.heroUrl && !failedHeaderUrls.includes(game.heroUrl)
      ? game.heroUrl
      : null
  const logoUrl =
    game.logoUrl && failedLogoUrl !== game.logoUrl ? game.logoUrl : null
  const year = releaseYear(game.releaseDate)
  const onHeaderError = React.useCallback((url: string) => {
    setFailedHeaderUrls((previous) =>
      previous.includes(url) ? previous : [...previous, url],
    )
  }, [])

  return (
    <section
      className={cn(
        "bg-surface-raised relative w-full overflow-hidden",
        APP_BANNER_HEIGHT_CLASS,
      )}
    >
      <MediaPlaceholder
        seed={game.steamgriddbId}
        blurHash={game.heroBlurHash ?? game.gridBlurHash}
      />
      {headerUrl ? (
        <img
          src={headerUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          onError={() => onHeaderError(headerUrl)}
        />
      ) : null}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:gap-4 sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={game.name}
                className={cn(
                  "h-12 w-auto max-w-[min(420px,60vw)] object-contain object-left",
                  "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:h-16",
                )}
                decoding="async"
                onError={() => setFailedLogoUrl(logoUrl)}
              />
            ) : (
              <h1
                className={cn(
                  "min-w-0 truncate text-2xl font-semibold tracking-[-0.02em] text-white",
                  "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] max-sm:text-xl sm:text-3xl",
                )}
              >
                {game.name}
              </h1>
            )}
            <GameFavoriteButton
              gameId={game.steamgriddbId}
              viewer={game.viewer}
              className="shrink-0 shadow-[0_6px_18px_oklch(0_0_0_/_0.35)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-white/75">
            <HeroStat value={game.favouritesCount} label="favourites" />
            <HeroDot />
            <HeroStat
              value={game.clipCount}
              label={game.clipCount === 1 ? "clip" : "clips"}
            />
            {year !== null ? (
              <>
                <HeroDot />
                <span>Released {year}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold text-white tabular-nums">
        {formatCount(value)}
      </span>
      <span>{label}</span>
    </span>
  )
}

function HeroDot() {
  return <span className="text-white/45">·</span>
}
