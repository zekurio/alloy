import { cn } from "@workspace/ui/lib/utils"

import type { GameDetail } from "@workspace/api"

import { hueForGame } from "@/lib/clip-format"
import { GameFavoriteButton } from "./game-favorite-button"

type GameHeaderBannerProps = {
  game: GameDetail
}

export function GameHeaderBanner({ game }: GameHeaderBannerProps) {
  const hue = hueForGame(game.name)

  return (
    <section
      className={cn(
        "relative overflow-hidden",
        "h-[clamp(120px,15vw,200px)] w-full"
      )}
    >
      {game.heroUrl ? (
        <img
          src={game.heroUrl}
          alt={game.name}
          className="absolute inset-0 size-full object-cover"
          decoding="async"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 80% at 30% 20%, oklch(0.32 0.14 ${hue}), oklch(0.08 0.04 ${hue}))`,
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:gap-4 sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className={cn(
                "h-12 w-auto max-w-[min(420px,60vw)] object-contain object-left",
                "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:h-16"
              )}
              decoding="async"
            />
          ) : (
            <h1
              className={cn(
                "min-w-0 truncate text-2xl font-semibold tracking-[-0.02em] text-foreground",
                "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] max-sm:text-xl sm:text-3xl"
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
