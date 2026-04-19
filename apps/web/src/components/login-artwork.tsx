import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import type { PublicClip } from "../lib/public-clips"

/**
 * Decorative left-pane carousel for the login page.
 *
 * Rows of public clips scrolling horizontally, with every other row moving in
 * the opposite direction — gives the pane a living, feed-like feel without
 * pulling in the real home grid (which requires auth anyway). The whole stack
 * is rotated a few degrees (2D only, no perspective) so the grid reads as
 * editorial backdrop rather than a literal product surface. The stage is
 * over-scaled so the rotation doesn't reveal empty corners.
 *
 * Server data comes in through the `clips` prop (populated by the route
 * loader). If the server returned nothing — offline, empty DB, cold start —
 * we fall back to a hand-picked tile set so the pane is never blank.
 *
 * Each row duplicates its tile list so the CSS marquee can wrap seamlessly
 * via `translateX(-50%)`. Pure CSS animation — no JS tick, no rAF, so this
 * stays cheap even while the form above is doing real work.
 */

// Evergreen fallback used when the clips API returns nothing. Titles are
// deliberately game-agnostic "highlight" vibes so the pane still looks alive
// even on a fresh install.
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

// Known games get curated hues so their tiles read as consistent colour
// families across the carousel. Anything unrecognised falls through to a
// stable hash of the title.
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

type Tile = { key: string; title: string; hue: number }

// Tile width scales with the viewport so the artwork reads the same whether
// we're on a 1280px laptop or a 2560px monitor. At fixed 360px, tiles looked
// huge on small panes and tiny on large ones — clamp() keeps the visual
// density (tiles-per-row, text size relative to tile) stable across sizes.
// Tile text and inset padding use the same clamp approach so proportions hold.
function Tile({ title, hue }: { title: string; hue: number }) {
  return (
    <div
      className={cn(
        "relative aspect-[16/10] shrink-0 overflow-hidden rounded-lg",
        "w-[clamp(240px,22vw,420px)]",
        "ring-1 ring-inset ring-white/5",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
      )}
      style={{
        background: `
          radial-gradient(120% 80% at 30% 20%, oklch(0.42 0.16 ${hue}) 0%, transparent 55%),
          linear-gradient(135deg, oklch(0.24 0.11 ${hue}) 0%, oklch(0.12 0.05 ${hue}) 70%, oklch(0.07 0 0) 100%)
        `,
      }}
    >
      <div className="absolute inset-x-[6%] bottom-[4%] text-[clamp(12px,1vw,16px)] font-semibold tracking-[-0.01em] text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
        {title}
      </div>
    </div>
  )
}

/**
 * One scrolling row. The track holds the tile list twice so the marquee
 * wraps seamlessly — once the first copy scrolls out of view, the second
 * copy is right where the first started.
 */
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
        className="flex w-max gap-[clamp(8px,0.9vw,18px)] animate-marquee-x"
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
              <Tile key={`${copy}-${t.key}`} title={t.title} hue={t.hue} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Split a list of tiles into `rowCount` roughly-equal rows, cycling through
 * the source so each row gets a distinct slice. If we have fewer clips than
 * rows (or tiles per row feel sparse), we repeat the pool to keep every row
 * dense — a short row would show the seam between the two marquee copies.
 */
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

export function LoginArtwork({ clips }: { clips: PublicClip[] }) {
  const ROW_COUNT = 5

  // Build the tile source: real public clips first, otherwise the fallback
  // title list. We don't mix the two — if the server returned anything at all
  // we show only real data.
  const source: Tile[] =
    clips.length > 0
      ? clips.map((c, i) => ({
          key: c.id || `clip-${i}`,
          title: c.title,
          hue: hueFor(c),
        }))
      : FALLBACK_TITLES.map((title, i) => ({
          key: `fallback-${i}`,
          title,
          hue: hashHue(title),
        }))

  const rows = buildRows(source, ROW_COUNT)

  // Per-row durations — slightly different so rows don't scroll in lockstep,
  // which would otherwise feel mechanical. Rows alternate direction.
  const rowSettings = [
    { durationSeconds: 80, reverse: false },
    { durationSeconds: 95, reverse: true },
    { durationSeconds: 70, reverse: false },
    { durationSeconds: 105, reverse: true },
    { durationSeconds: 85, reverse: false },
  ]

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
            reverse={rowSettings[i].reverse}
            durationSeconds={rowSettings[i].durationSeconds}
          />
        ))}
      </div>

      {/* Right-edge vignette so the form pane reads cleanly, plus a light
          overall darken so the tiles feel like backdrop rather than content. */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-background" />
      <div className="absolute inset-0 bg-background/30" />
    </div>
  )
}
