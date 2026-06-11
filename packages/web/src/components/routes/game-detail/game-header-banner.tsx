import type { GameDetail } from "@alloy/api"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"

import { GameFavoriteButton } from "./game-favorite-button"

type GameHeaderBannerProps = {
  game: GameDetail
}

export function GameHeaderBanner({ game }: GameHeaderBannerProps) {
  const [failedHeroUrl, setFailedHeroUrl] = React.useState<string | null>(null)
  const [failedLogoUrl, setFailedLogoUrl] = React.useState<string | null>(null)
  const heroUrl =
    game.heroUrl && failedHeroUrl !== game.heroUrl ? game.heroUrl : null
  const logoUrl =
    game.logoUrl && failedLogoUrl !== game.logoUrl ? game.logoUrl : null

  return (
    <section
      className={cn(
        "relative overflow-hidden",
        APP_BANNER_HEIGHT_CLASS,
        "w-full",
      )}
    >
      <MediaPlaceholder
        seed={game.steamgriddbId}
        blurHash={game.heroBlurHash}
      />
      {heroUrl ? (
        <img
          src={heroUrl}
          alt={game.name}
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          onError={() => setFailedHeroUrl(heroUrl)}
        />
      ) : null}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:gap-4 sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
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
                "min-w-0 truncate text-2xl font-semibold tracking-[-0.02em] text-foreground",
                "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] max-sm:text-xl sm:text-3xl",
              )}
            >
              {game.name}
            </h1>
          )}
          <GameFavoriteButton
            slug={game.slug}
            viewer={game.viewer}
            count={game.favouritesCount}
            className="shadow-[0_6px_18px_oklch(0_0_0_/_0.35)]"
          />
        </div>
      </div>
    </section>
  )
}
