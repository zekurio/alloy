import { t } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { GameLogo } from "./game-logo"

export type GameCardData = {
  id: string
  name: string
  slug: string | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridBlurHash: string | null
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
  const [heroFailed, setHeroFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const heroSrc = game.heroUrl && !heroFailed ? game.heroUrl : null
  const logoSrc = game.logoUrl && !logoFailed ? game.logoUrl : null

  return (
    <>
      <MediaPlaceholder
        seed={game.slug ?? game.id}
        blurHash={game.heroBlurHash ?? game.gridBlurHash}
      />
      {heroSrc ? (
        <img
          src={heroSrc}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setHeroFailed(true)}
        />
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/15"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {logoSrc ? (
          <GameLogo
            src={logoSrc}
            name={game.name}
            variant="card"
            loading="lazy"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span
            className={cn(
              "px-2 text-center text-lg font-semibold tracking-[-0.02em] text-white",
              "line-clamp-2 drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:text-xl",
            )}
          >
            {game.name}
          </span>
        )}
      </div>
    </>
  )
}

export function GameCard({ game, link, className }: GameCardProps) {
  const surface = cn(
    "group/game-card relative block aspect-[16/5] overflow-hidden rounded-lg",
    "bg-neutral-900",
    "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    className,
  )

  if (link?.kind === "game") {
    return (
      <Link
        to="/games/$gameId"
        params={{ gameId: link.slug }}
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
        aria-label={t("Show clips for {game}", { game: game.name })}
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
