import { t } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { gameDisplayName } from "@/lib/game-display-name"

import { GameLogo } from "./game-logo"

type GameCardData = {
  id: string
  name: string
  slug: string | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridBlurHash: string | null
  logoUrl: string | null
}

type GameCardLink =
  | { kind: "game"; slug: string }
  | { kind: "user-clips"; username: string; slug: string }

type GameCardProps = {
  game: GameCardData
  link?: GameCardLink
  className?: string
}

function GameCardBody({ game, name }: { game: GameCardData; name: string }) {
  const hero = useImageLoaded(game.heroUrl)
  // Scoped to the URL, so a card reused for another game retries its logo.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const heroSrc = hero.status === "error" ? null : game.heroUrl
  const logoSrc =
    game.logoUrl && failedLogoUrl !== game.logoUrl ? game.logoUrl : null

  return (
    <>
      {/* Anything painted under the hero tints its antialiased corner pixels,
          so the placeholder only stays until the hero covers it. */}
      {hero.loaded ? null : (
        <MediaPlaceholder
          seed={game.slug ?? game.id}
          blurHash={game.heroBlurHash ?? game.gridBlurHash}
        />
      )}
      {heroSrc ? (
        <img
          ref={hero.ref}
          src={heroSrc}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
          onLoad={hero.markLoaded}
          onError={hero.markError}
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
            name={name}
            variant="card"
            loading="lazy"
            onError={() => setFailedLogoUrl(logoSrc)}
          />
        ) : (
          <span
            className={cn(
              "px-2 text-center text-lg font-semibold tracking-[-0.02em] text-white",
              "line-clamp-2 drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:text-xl",
            )}
          >
            {name}
          </span>
        )}
      </div>
    </>
  )
}

export function GameCard({ game, link, className }: GameCardProps) {
  const name = gameDisplayName(game)
  const surface = cn(
    "group/game-card relative block aspect-[16/5] overflow-hidden rounded-lg",
    "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    className,
  )

  if (link?.kind === "game") {
    return (
      <Link
        to="/games/$gameId"
        params={{ gameId: link.slug }}
        aria-label={name}
        className={surface}
      >
        <GameCardBody game={game} name={name} />
      </Link>
    )
  }

  if (link?.kind === "user-clips") {
    return (
      <Link
        to="/u/$username/all"
        params={{ username: link.username }}
        search={{ game: link.slug }}
        aria-label={t("Show clips for {game}", { game: name })}
        className={surface}
      >
        <GameCardBody game={game} name={name} />
      </Link>
    )
  }

  return (
    <article className={surface} aria-label={name}>
      <GameCardBody game={game} name={name} />
    </article>
  )
}
