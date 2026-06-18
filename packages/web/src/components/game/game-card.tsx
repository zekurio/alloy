import { gameGridUrl } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"

import { apiOrigin } from "@/lib/env"

export type GameCardData = {
  steamgriddbId: number
  name: string
  slug: string | null
  heroUrl: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
}

export type GameCardLink =
  | { kind: "game"; steamgriddbId: number }
  | { kind: "user-clips"; username: string; slug: string }

type GameCardProps = {
  game: GameCardData
  link?: GameCardLink
  className?: string
}

function GameCardBody({ game }: { game: GameCardData }) {
  const gridSrc =
    game.gridUrl && game.slug ? gameGridUrl(game.slug, apiOrigin()) : null

  return (
    <>
      <MediaPlaceholder
        seed={game.steamgriddbId}
        blurHash={game.gridBlurHash}
      />
      {gridSrc ? (
        <img
          src={gridSrc}
          alt=""
          crossOrigin="use-credentials"
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </>
  )
}

export function GameCard({ game, link, className }: GameCardProps) {
  const surface = cn(
    "group/game-card relative block aspect-[2/3] overflow-hidden rounded-md [-webkit-mask-image:linear-gradient(black,black)] [mask-image:linear-gradient(black,black)]",
    "bg-neutral-900",
    "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    className,
  )

  if (link?.kind === "game") {
    return (
      <Link
        to="/games/$gameId"
        params={{ gameId: String(link.steamgriddbId) }}
        aria-label={game.name}
        className={surface}
      >
        <GameCardBody game={game} />
      </Link>
    )
  }

  if (link?.kind === "user-clips") {
    return (
      <Link
        to="/u/$username/all"
        params={{ username: link.username }}
        search={{ game: link.slug }}
        aria-label={tx("Show clips for {game}", { game: game.name })}
        className={surface}
      >
        <GameCardBody game={game} />
      </Link>
    )
  }

  return (
    <article className={surface} aria-label={game.name}>
      <GameCardBody game={game} />
    </article>
  )
}
