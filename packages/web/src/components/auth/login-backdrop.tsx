import { clipThumbnailUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import { apiOrigin } from "@/lib/env"

type LoginBackdropProps = {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

// The tiled wall is laid out larger than the viewport and rotated, so its edges
// stay off-screen as rows drift. Tuned to keep all four corners covered at a 15°
// slope.
const SLOPE_DEGREES = -15
// Enough rows to overflow the oversized, rotated stage so the corners stay
// covered at any viewport height.
const ROW_COUNT = 12
// Per-row scroll duration (seconds); alternating rows drift in opposite
// directions at slightly different speeds for an organic feel.
const ROW_DURATIONS = [62, 78, 70, 86, 66, 82, 74, 90, 68, 84, 72, 88] as const
// Minimum tiles in one marquee copy. A row only loops seamlessly if a single
// copy is wider than the (oversized, rotated) stage, so we recycle the row's
// thumbnails up to this count before duplicating for the loop.
const MIN_TILES_PER_COPY = 16

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

/** Split the thumbnails into `rowCount` interleaved rows, each non-empty. */
function splitIntoRows(urls: string[], rowCount: number): string[][] {
  const rows: string[][] = Array.from({ length: rowCount }, () => [])
  urls.forEach((url, i) => {
    rows[i % rowCount]!.push(url)
  })
  // Make sure no row is empty (so every row scrolls) by recycling URLs.
  return rows.map((row, i) => (row.length > 0 ? row : [urls[i % urls.length]!]))
}

function MarqueeRow({
  urls,
  durationSec,
  reverse,
  paused,
}: {
  urls: string[]
  durationSec: number
  reverse: boolean
  paused: boolean
}) {
  // Recycle the row's thumbnails up to a copy wide enough to overrun the stage,
  // then duplicate it so translateX(-50%) lands on an identical frame for a
  // seamless loop.
  const copy = Array.from(
    { length: Math.max(MIN_TILES_PER_COPY, urls.length) },
    (_, i) => urls[i % urls.length]!,
  )
  const tiles = [...copy, ...copy]
  return (
    <div className="flex h-[clamp(120px,15vh,200px)] shrink-0 overflow-hidden">
      <div
        className="flex h-full w-max gap-3 pr-3"
        style={{
          animationName: "login-backdrop-marquee",
          animationDuration: `${durationSec}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationDirection: reverse ? t("reverse") : t("normal"),
          animationPlayState: paused ? t("paused") : t("running"),
        }}
      >
        {tiles.map((url, i) => (
          <div
            key={i}
            className="aspect-video h-full shrink-0 overflow-hidden rounded-lg bg-white/5"
          >
            <img
              src={url}
              alt=""
              aria-hidden
              draggable={false}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Jellyfin-inspired login backdrop: a live wall of public clip thumbnails laid
 * out in several rows that slowly scroll in alternating directions, the whole
 * grid sloped 15° and blurred/darkened behind the login form. No server-side
 * compositing — thumbnails load directly from `/api/clips/:id/thumbnail`.
 */
export function LoginBackdrop({
  enabled,
  blurPx,
  darkenOpacity,
}: LoginBackdropProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    if (!enabled) {
      setUrls([])
      return
    }
    let cancelled = false
    void api.authConfig
      .fetchBackdrops()
      .then(({ clips, clipIds }) => {
        if (cancelled) return
        const nextUrls =
          clips.length > 0
            ? clips.map((clip) =>
                clipThumbnailUrl(clip.id, apiOrigin(), clip.thumbVersion),
              )
            : clipIds.map((id) => clipThumbnailUrl(id, apiOrigin()))
        setUrls(nextUrls)
      })
      .catch(() => {
        if (!cancelled) setUrls([])
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!enabled || urls.length === 0) return null

  const rows = splitIntoRows(urls, ROW_COUNT)

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[oklch(12%_0.01_250)]">
      <div
        className="absolute top-1/2 left-1/2 flex h-[170%] w-[170%] flex-col justify-center gap-3"
        style={{
          transform: `translate(-50%, -50%) rotate(${SLOPE_DEGREES}deg)`,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        }}
      >
        {rows.map((rowUrls, i) => (
          <MarqueeRow
            key={i}
            urls={rowUrls}
            durationSec={ROW_DURATIONS[i % ROW_DURATIONS.length]!}
            reverse={i % 2 === 1}
            paused={reducedMotion}
          />
        ))}
      </div>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundColor: `rgb(5 6 9 / ${darkenOpacity})` }}
      />
      <style>{`@keyframes login-backdrop-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  )
}
