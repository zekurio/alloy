import { CalendarIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { hueForGame } from "../../../lib/clip-format"
import type { GameRow } from "../../../lib/games-api"

type GameHeaderBannerProps = {
  game: GameRow
}

export function GameHeaderBanner({ game }: GameHeaderBannerProps) {
  const hue = hueForGame(game.name)
  const released = formatReleaseDate(game.releaseDate)

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-lg",
        "aspect-[16/6] max-h-[420px] min-h-[220px]"
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

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:p-7">
        {game.logoUrl ? (
          <img
            src={game.logoUrl}
            alt={game.name}
            className={cn(
              "h-14 w-auto max-w-[min(480px,70%)] object-contain object-left",
              "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)] sm:h-16"
            )}
            decoding="async"
          />
        ) : (
          <h1
            className={cn(
              "text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl",
              "drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)]"
            )}
          >
            {game.name}
          </h1>
        )}
        {released ? (
          <div className="flex items-center gap-3 font-mono text-2xs tracking-[0.08em] text-foreground-dim uppercase">
            <span className="inline-flex items-center gap-1.5 leading-none">
              <CalendarIcon className="size-3 shrink-0" aria-hidden />
              <span>released {released}</span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" })
}
