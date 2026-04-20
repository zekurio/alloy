import { Link } from "@tanstack/react-router"

import { cn } from "@workspace/ui/lib/utils"

import { hueForGame } from "../../../lib/clip-format"
import type { GameListRow } from "../../../lib/games-api"

type GameCardProps = {
  game: GameListRow
}

/**
 * Aspect-video game card. Hero art fills the surface, logo sits bottom-left
 * on a soft gradient for legibility. No title / clip-count chrome — the
 * card is pure identity, everything else lives one click deeper on /g/:slug.
 */
export function GameCard({ game }: GameCardProps) {
  const hue = hueForGame(game.name)

  return (
    <Link
      to="/g/$slug"
      params={{ slug: game.slug }}
      aria-label={game.name}
      className={cn(
        "group/game-card relative flex aspect-video flex-col overflow-hidden rounded-md",
        "bg-neutral-900",
        "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:shadow-[0_0_0_1px_var(--accent-border)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {game.heroUrl ? (
        <img
          src={game.heroUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
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
        className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      <div className="relative mt-auto p-2">
        {game.logoUrl ? (
          <img
            src={game.logoUrl}
            alt={game.name}
            className={cn(
              "h-7 w-auto max-w-[75%] object-contain object-left",
              "drop-shadow-[0_2px_8px_oklch(0_0_0_/_0.6)]"
            )}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="truncate text-sm font-semibold text-foreground drop-shadow-[0_2px_8px_oklch(0_0_0_/_0.6)]">
            {game.name}
          </span>
        )}
      </div>
    </Link>
  )
}
