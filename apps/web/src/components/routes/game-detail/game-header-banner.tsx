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
        "relative -mx-4 -mt-6 overflow-hidden md:-mx-8",
        "aspect-[16/4] max-h-[280px] min-h-[160px]"
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
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4 sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className={cn(
                "h-16 w-auto max-w-[min(560px,72vw)] object-contain object-left",
                "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:h-20"
              )}
              decoding="async"
            />
          ) : (
            <h1
              className={cn(
                "truncate text-2xl font-semibold text-foreground sm:text-3xl",
                "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)]"
              )}
            >
              {game.name}
            </h1>
          )}
        </div>
        <GameFavoriteButton
          slug={game.slug}
          viewer={game.viewer}
          className="shadow-[0_6px_18px_oklch(0_0_0_/_0.35)]"
        />
      </div>
    </section>
  )
}
