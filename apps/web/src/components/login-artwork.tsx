import * as React from "react"
import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import type { PublicClip } from "../lib/public-clips"

const FALLBACK_TITLES = [
  "Clutch 1v3 on Ascent",
  "Last-second defuse",
  "Pentakill baron pit",
  "Sova recon dart",
  "200 IQ smoke wall",
  "Perfect ult combo",
  "5v5 team clutch",
  "Triple kill headshot",
  "Headshot across map",
  "Invisible wall bug",
  "Impossible flick",
  "Quad in ranked",
  "Wingman no-scope",
  "Victory royale solo squad",
  "Ace with viper wall",
  "Goal of the year",
  "Ranked grind stream",
  "Ace — lost pistol",
  "Triple kill on Haven",
  "Operator 1-tap spam",
] as const

const GAME_HUE: Record<string, number> = {
  Valorant: 300,
  "Counter-Strike 2": 45,
  CS2: 45,
  "Apex Legends": 30,
  "League of Legends": 210,
  Fortnite: 260,
  "Overwatch 2": 20,
  "Rocket League": 220,
  Dota2: 15,
  Minecraft: 140,
}

function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}

function hueFor(clip: { title: string; game: string | null }): number {
  if (clip.game && GAME_HUE[clip.game] !== undefined) return GAME_HUE[clip.game]
  return hashHue(clip.title)
}

type Tile = {
  key: string
  title: string
  hue: number
  thumbUrl: string | null
}

function Tile({
  title,
  hue,
  thumbUrl,
}: {
  title: string
  hue: number
  thumbUrl: string | null
}) {
  return (
    <div
      className={cn(
        "relative aspect-[16/10] shrink-0 overflow-hidden rounded-lg",
        "w-[clamp(240px,22vw,420px)]",
        "ring-1 ring-white/5 ring-inset",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      )}
      style={{
        background: `
          radial-gradient(120% 80% at 30% 20%, oklch(0.42 0.16 ${hue}) 0%, transparent 55%),
          linear-gradient(135deg, oklch(0.24 0.11 ${hue}) 0%, oklch(0.12 0.05 ${hue}) 70%, oklch(0.07 0 0) 100%)
        `,
      }}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {thumbUrl ? (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      ) : null}
      <div className="absolute inset-x-[6%] bottom-[4%] text-[clamp(12px,1vw,16px)] font-semibold tracking-[-0.01em] text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
        {title}
      </div>
    </div>
  )
}

function MarqueeRow({
  tiles,
  reverse,
  durationSeconds,
}: {
  tiles: Tile[]
  reverse: boolean
  durationSeconds: number
}) {
  return (
    <div className="relative shrink-0 overflow-hidden">
      <div
        className="animate-marquee-x flex w-max gap-[clamp(8px,0.9vw,18px)]"
        style={
          {
            "--marquee-duration": `${durationSeconds}s`,
            "--marquee-direction": reverse ? "reverse" : "normal",
          } as CSSProperties
        }
      >
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex gap-[clamp(8px,0.9vw,18px)]"
            aria-hidden={copy === 1}
          >
            {tiles.map((t) => (
              <Tile
                key={`${copy}-${t.key}`}
                title={t.title}
                hue={t.hue}
                thumbUrl={t.thumbUrl}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildRows(source: Tile[], rowCount: number): Tile[][] {
  const MIN_PER_ROW = 8
  const pool: Tile[] = []
  // Pad the pool so each row has at least MIN_PER_ROW tiles.
  const needed = rowCount * MIN_PER_ROW
  while (pool.length < needed) {
    pool.push(...source)
  }

  const rows: Tile[][] = Array.from({ length: rowCount }, () => [])
  pool.forEach((tile, i) => {
    rows[i % rowCount].push({ ...tile, key: `${tile.key}-${i}` })
  })
  return rows
}

const ROW_COUNT = 5
const ROW_SETTINGS = [
  { durationSeconds: 80, reverse: false },
  { durationSeconds: 95, reverse: true },
  { durationSeconds: 70, reverse: false },
  { durationSeconds: 105, reverse: true },
  { durationSeconds: 85, reverse: false },
] as const

export const LoginArtwork = React.memo(function LoginArtwork({
  clips,
}: {
  clips: PublicClip[]
}) {
  const rows = React.useMemo(() => {
    const source: Tile[] =
      clips.length > 0
        ? clips.map((c, i) => ({
            key: c.id || `clip-${i}`,
            title: c.title,
            hue: hueFor(c),
            thumbUrl: c.thumbUrl,
          }))
        : FALLBACK_TITLES.map((title, i) => ({
            key: `fallback-${i}`,
            title,
            hue: hashHue(title),
            thumbUrl: null,
          }))
    return buildRows(source, ROW_COUNT)
  }, [clips])

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Rotated 2D stage — rows fill the pane vertically. We over-scale so
          the rotated rectangle still covers all four corners of the pane. */}
      <div
        className="absolute inset-0 flex flex-col justify-center gap-[clamp(8px,0.9vw,18px)]"
        style={{
          transform: "rotate(-8deg) scale(1.25)",
          transformOrigin: "center",
        }}
      >
        {rows.map((rowTiles, i) => (
          <MarqueeRow
            key={i}
            tiles={rowTiles}
            reverse={ROW_SETTINGS[i].reverse}
            durationSeconds={ROW_SETTINGS[i].durationSeconds}
          />
        ))}
      </div>

      {/* Right-edge vignette so the form pane reads cleanly, plus a light
          overall darken so the tiles feel like backdrop rather than content. */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-background" />
      <div className="absolute inset-0 bg-background/30" />
    </div>
  )
})
