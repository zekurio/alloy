import { cn } from "@workspace/ui/lib/utils"

import { hueForGame } from "@/lib/clip-format"
import type { GameRow } from "@/lib/games-api"

type GameHeaderBannerProps = {
  game: GameRow
}

export function GameHeaderBanner({ game }: GameHeaderBannerProps) {
  const hue = hueForGame(game.name)

  return (
    <section
      className={cn(
        "relative -mx-8 -mt-6 overflow-hidden",
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

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 sm:p-6">
        {game.logoUrl ? (
          <img
            src={game.logoUrl}
            alt={game.name}
            className={cn(
              "h-16 w-auto max-w-[min(560px,70%)] object-contain object-left",
              "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:h-20"
            )}
            decoding="async"
          />
        ) : (
          <h1
            className={cn(
              "text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl",
              "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)]"
            )}
          >
            {game.name}
          </h1>
        )}
      </div>
    </section>
  )
}
