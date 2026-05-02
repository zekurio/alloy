import * as React from "react"

import { clipThumbnailUrl, type LoginSplashClip } from "@workspace/api"
import { cn } from "@workspace/ui/lib/utils"

import { apiOrigin } from "@/lib/env"

const MAX_SOURCE_TILES = 12
const MIN_PER_ROW = 8
const ROW_COUNT = 7
const ROTATION_DEG = 8
const SCALE = 1.25
const TILE_GAP = "clamp(4px, 0.9cqw, 18px)"
const ROW_OFFSETS = [
  "0%",
  "-24%",
  "-10%",
  "-34%",
  "-16%",
  "-28%",
  "-6%",
] as const

export function hasLoginArtworkClips(clips: LoginSplashClip[]): boolean {
  return clips.length > 0
}

function buildRows(clips: LoginSplashClip[]): LoginSplashClip[][] {
  if (clips.length === 0) return []

  const source = clips.slice(0, MAX_SOURCE_TILES)
  const pool: LoginSplashClip[] = []
  while (pool.length < ROW_COUNT * MIN_PER_ROW) {
    pool.push(...source)
  }

  const rows: LoginSplashClip[][] = Array.from({ length: ROW_COUNT }, () => [])
  pool.forEach((clip, i) => {
    rows[i % ROW_COUNT]!.push(clip)
  })
  return rows
}

function Tile({
  clip,
  origin,
}: {
  clip: LoginSplashClip
  origin: string | undefined
}) {
  return (
    <div
      className={cn(
        "relative aspect-video shrink-0 overflow-hidden rounded-lg",
        "transform-gpu bg-surface [contain:paint]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/5 ring-inset"
      )}
      style={{ width: "clamp(96px, 22cqw, 420px)" }}
    >
      <img
        src={clipThumbnailUrl(clip.id, origin)}
        alt=""
        loading="eager"
        decoding="async"
        draggable={false}
        sizes="22vw"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  )
}

export const LoginArtwork = React.memo(function LoginArtwork({
  clips,
}: {
  clips: LoginSplashClip[]
}) {
  const origin = apiOrigin()
  const rows = React.useMemo(() => buildRows(clips), [clips])
  if (rows.length === 0) return null

  return (
    <div
      aria-hidden
      className="[container-type:size] pointer-events-none absolute inset-0 overflow-hidden bg-black"
    >
      <div
        className="absolute inset-0 flex transform-gpu flex-col justify-center"
        style={{
          gap: TILE_GAP,
          transform: `rotate(-${ROTATION_DEG}deg) scale(${SCALE})`,
          transformOrigin: "center",
        }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="relative shrink-0 overflow-hidden">
            <div
              className="flex w-max transform-gpu"
              style={{
                gap: TILE_GAP,
                transform: `translate3d(${ROW_OFFSETS[rowIndex % ROW_OFFSETS.length]}, 0, 0)`,
              }}
            >
              {[0, 1].map((copy) => (
                <div key={copy} className="flex" style={{ gap: TILE_GAP }}>
                  {row.map((clip, columnIndex) => (
                    <Tile
                      key={`${copy}-${clip.id}-${rowIndex}-${columnIndex}`}
                      clip={clip}
                      origin={origin}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})
