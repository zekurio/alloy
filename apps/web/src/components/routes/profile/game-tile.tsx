import { Link } from "@tanstack/react-router"

import { cn } from "@workspace/ui/lib/utils"

export type GameEntry = {
  name: string
  /**
   * SteamGridDB-backed URL slug. Null for legacy free-form `game` strings
   * without a resolved `gameRef` — those tiles render as non-interactive
   * static cards.
   */
  slug: string | null
  count: number
  hue: number
  /** Hero art (banner) from the resolved `gameRef`, when available. */
  heroUrl: string | null
  /** Logo art from the resolved `gameRef`, when available. */
  logoUrl: string | null
}

type GameTileProps = {
  game: GameEntry
  /**
   * When set, clicking the tile navigates to this user's Clips tab with
   * the game pre-filtered. Only provided for tiles that have a resolvable
   * slug — null-slug tiles fall back to the static `<article>` shell.
   */
  username?: string
}

/**
 * Profile "Recently clipped" tile. Direct copy of the `/games` `GameCard`
 * style — hero + logo on an aspect-video surface — sized to match the
 * clip cards in the same section (w-60 = 240px, the ClipGrid minmax).
 */
export function GameTile({ game, username }: GameTileProps) {
  const className = cn(
    "group/game-tile relative flex aspect-video w-60 shrink-0 snap-start flex-col overflow-hidden rounded-md",
    "bg-neutral-900",
    "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:shadow-[0_0_0_1px_var(--accent-border)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  )

  const body = (
    <>
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
            background: `radial-gradient(120% 80% at 30% 20%, oklch(0.32 0.14 ${game.hue}), oklch(0.08 0.04 ${game.hue}))`,
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
    </>
  )

  if (username && game.slug) {
    return (
      <Link
        to="/u/$username/all"
        params={{ username }}
        search={{ game: game.slug }}
        className={className}
        aria-label={`Show clips for ${game.name}`}
      >
        {body}
      </Link>
    )
  }

  return (
    <article className={className} aria-label={game.name}>
      {body}
    </article>
  )
}
