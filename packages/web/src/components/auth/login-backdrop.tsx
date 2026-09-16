import { clipThumbnailUrl } from "@alloy/api"
import { cssVariables } from "@alloy/ui/lib/css-properties"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { backdropsQueryOptions } from "@/lib/auth-query-keys"
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
// copy is wider than the (oversized, rotated) stage, so we recycle thumbnails
// up to this count before duplicating for the loop.
const MIN_TILES_PER_COPY = 16
// The auth form sits directly on the backdrop, so light themes show the wall at
// a fraction of its configured strength: dark copy loses contrast against image
// detail far faster than light copy does against a dark wash.
const LIGHT_WALL_OPACITY_RATIO = 0.35

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (!globalThis.window?.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

/**
 * Give every row an alternating thumbnail sequence instead of partitioning the
 * clip set across rows. Offsetting each row prevents vertical bands of the same
 * clip while still keeping each marquee copy wide enough to loop cleanly.
 */
function buildRows(urls: string[], rowCount: number): string[][] {
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from(
      { length: Math.max(MIN_TILES_PER_COPY, urls.length) },
      (_, tileIndex) => urls[(rowIndex + tileIndex) % urls.length]!,
    ),
  )
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
  // Duplicate the row so translateX(-50%) lands on an identical frame for a
  // seamless loop.
  const tiles = [...urls, ...urls]
  return (
    <div className="flex h-[clamp(120px,15vh,200px)] shrink-0 overflow-hidden">
      <div
        className="flex h-full w-max gap-3 pr-3"
        style={{
          animationName: "login-backdrop-marquee",
          animationDuration: `${durationSec}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationDirection: reverse ? "reverse" : "normal",
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        {tiles.map((url, i) => (
          <div
            key={i}
            className="bg-foreground/5 aspect-video h-full shrink-0 overflow-hidden rounded-lg"
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
 * grid sloped 15° and blurred behind the login form, then faded into the active
 * theme's surface so the form stays readable. No server-side compositing —
 * thumbnails load directly from `/api/clips/:id/thumbnail`.
 */
export function LoginBackdrop({
  enabled,
  blurPx,
  darkenOpacity,
}: LoginBackdropProps) {
  const reducedMotion = usePrefersReducedMotion()
  const { data, isError } = useQuery({
    ...backdropsQueryOptions(),
    enabled,
  })
  const urls = useMemo(() => {
    if (!enabled || isError) return []
    return (
      data?.clips.map((clip) =>
        clipThumbnailUrl(clip.id, apiOrigin(), clip.thumbVersion),
      ) ?? []
    )
  }, [data, enabled, isError])

  if (!enabled || urls.length === 0) return null

  const rows = buildRows(urls, ROW_COUNT)
  // Fading the wall into the themed surface is equivalent in dark to the old
  // full-strength wall plus scrim, and it gives the light theme one knob to
  // cap the wall without touching admin config.
  const wallOpacity = 1 - darkenOpacity

  return (
    <div className="bg-surface-sunken pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="login-backdrop-wall absolute top-1/2 left-1/2 flex h-[170%] w-[170%] flex-col justify-center gap-3"
        style={cssVariables({
          "--login-wall-opacity": wallOpacity,
          transform: `translate(-50%, -50%) rotate(${SLOPE_DEGREES}deg)`,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        })}
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
      <style>{`
        .login-backdrop-wall {
          opacity: var(--login-wall-opacity);
        }
        :root.light .login-backdrop-wall {
          opacity: calc(var(--login-wall-opacity) * ${LIGHT_WALL_OPACITY_RATIO});
        }
        @keyframes login-backdrop-marquee {
          from { transform: translateX(0) }
          to { transform: translateX(-50%) }
        }
      `}</style>
    </div>
  )
}
