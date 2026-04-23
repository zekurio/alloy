import { Link } from "@tanstack/react-router"

import { cn } from "@workspace/ui/lib/utils"

import { hueForGame } from "@/lib/clip-format"
import { publicOrigin } from "@/lib/env"

export type GameCardData = {
  name: string
  slug: string | null
  heroUrl: string | null
  gridUrl: string | null
  logoUrl: string | null
}

export type GameCardLink =
  | { kind: "game"; slug: string }
  | { kind: "user-clips"; username: string; slug: string }

type GameCardProps = {
  game: GameCardData
  link?: GameCardLink
  className?: string
}

function GameCardBody({ game }: { game: GameCardData }) {
  const hue = hueForGame(game.name)
  const gridSrc =
    game.gridUrl && game.slug
      ? `${publicOrigin()}/api/games/${encodeURIComponent(game.slug)}/grid`
      : null

  if (gridSrc) {
    return (
      <img
        src={gridSrc}
        alt=""
        crossOrigin="anonymous"
        className="block h-full w-full rounded-[inherit] object-cover [backface-visibility:hidden]"
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <div
      aria-hidden
      className="h-full w-full rounded-[inherit]"
      style={{
        background: `radial-gradient(120% 80% at 30% 20%, oklch(0.32 0.14 ${hue}), oklch(0.08 0.04 ${hue}))`,
      }}
    />
  )
}

export function GameCard({ game, link, className }: GameCardProps) {
  const surface = cn(
    "group/game-card block [container-type:inline-size] relative isolate flex aspect-[2/3] flex-col overflow-hidden rounded-md border-2 border-neutral-900 [backface-visibility:hidden] [contain:paint] [transform:translateZ(0)]",
    "bg-neutral-900",
    "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    className
  )

  if (link?.kind === "game") {
    return (
      <Link
        to="/g/$slug"
        params={{ slug: link.slug }}
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
        aria-label={`Show clips for ${game.name}`}
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
