import { Link } from "@tanstack/react-router"
import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { hueForGame } from "../lib/clip-format"
import { apiOrigin } from "../lib/env"

export type GameCardData = {
  name: string
  slug: string | null
  heroUrl: string | null
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

type Rgb = { r: number; g: number; b: number }

function useDominantColor(src: string | null): Rgb | null {
  const [color, setColor] = React.useState<Rgb | null>(null)

  React.useEffect(() => {
    setColor(null)
    if (!src) return
    if (typeof window === "undefined") return

    let cancelled = false
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.decoding = "async"
    img.onload = () => {
      if (cancelled) return
      try {
        const next = sampleDominant(img)
        if (next) setColor(next)
      } catch {
        return
      }
    }
    img.src = src
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [src])

  return color
}

function sampleDominant(img: HTMLImageElement): Rgb | null {
  const size = 24
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const a = data[i + 3] ?? 0
    if (a < 32) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min < 18) continue
    if (max < 40 || min > 230) continue
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const cur = buckets.get(key)
    if (cur) {
      cur.r += r
      cur.g += g
      cur.b += b
      cur.n++
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }

  let best: { r: number; g: number; b: number; n: number } | null = null
  for (const v of buckets.values()) {
    if (!best || v.n > best.n) best = v
  }
  if (!best) return null
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
}

function GameCardBody({ game }: { game: GameCardData }) {
  const hue = hueForGame(game.name)
  const heroSrc =
    game.heroUrl && game.slug
      ? `${apiOrigin()}/api/games/${encodeURIComponent(game.slug)}/hero`
      : null
  const dominant = useDominantColor(heroSrc)
  const labelBg = dominant
    ? `rgb(${Math.round(dominant.r)} ${Math.round(dominant.g)} ${Math.round(dominant.b)} / 0.6)`
    : "rgb(0 0 0 / 0.7)"

  return (
    <>
      {heroSrc ? (
        <img
          src={heroSrc}
          alt=""
          crossOrigin="anonymous"
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
        className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/25 to-transparent"
      />

      <div
        className="relative mt-auto"
        style={{ padding: "clamp(0.5rem, 3.5cqi, 1rem)" }}
      >
        <div
          className={cn(
            "flex max-w-full items-center",
            "backdrop-blur-xl backdrop-saturate-150",
            "ring-1 ring-white/15",
            "shadow-[0_4px_16px_-4px_rgb(0_0_0_/_0.5)]"
          )}
          style={{
            backgroundColor: labelBg,
            padding: "clamp(0.375rem, 2cqi, 0.625rem) clamp(0.5rem, 3cqi, 0.875rem)",
            borderRadius: "clamp(0.25rem, 1.5cqi, 0.5rem)",
          }}
        >
          <span
            className="truncate font-semibold text-white drop-shadow-sm"
            style={{ fontSize: "clamp(0.75rem, 5cqi, 1.25rem)" }}
          >
            {game.name}
          </span>
        </div>
      </div>
    </>
  )
}

export function GameCard({ game, link, className }: GameCardProps) {
  const surface = cn(
    "group/game-card relative flex aspect-video flex-col overflow-hidden rounded-md isolate [container-type:inline-size]",
    "bg-neutral-900 [transform:translateZ(0)]",
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
