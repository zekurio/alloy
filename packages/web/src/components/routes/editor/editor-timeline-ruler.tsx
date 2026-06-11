import { cn } from "alloy-ui/lib/utils"

const RULER_INTERVALS_SEC = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800,
]

function rulerIntervalSec(visibleDurationSec: number): number {
  for (const interval of RULER_INTERVALS_SEC) {
    if (visibleDurationSec / interval <= 12) return interval
  }
  return 3600
}

function formatRulerSec(sec: number): string {
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  const wholeSeconds = Math.floor(seconds)
  const base = `${minutes}:${wholeSeconds.toString().padStart(2, "0")}`
  const fraction = Math.round((seconds - wholeSeconds) * 10)
  return fraction > 0 ? `${base}.${fraction}` : base
}

/**
 * Labels at major intervals over a dense strip of minor ticks. The interval
 * adapts to the visible (zoomed) time span so zooming in reveals finer
 * graduations.
 */
export function TimelineRuler({
  spanMs,
  visibleMs,
  widthRatio,
}: {
  /** Total time the ruler strip covers (the scrollable track). */
  spanMs: number
  /** Time visible in the viewport at the current zoom. */
  visibleMs: number
  /** Strip width relative to the viewport (>= 1). */
  widthRatio: number
}) {
  const spanSec = spanMs / 1000
  if (spanSec <= 0 || visibleMs <= 0) return <div className="h-7" />

  const major = rulerIntervalSec(visibleMs / 1000)
  const minor = major / 10
  const tickCount = Math.min(2000, Math.floor(spanSec / minor))
  const ticks: Array<{ sec: number; kind: "major" | "mid" | "minor" }> = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push({
      sec: i * minor,
      kind: i % 10 === 0 ? "major" : i % 5 === 0 ? "mid" : "minor",
    })
  }
  // Label-edge fade thresholds shrink as the strip widens with zoom.
  const labelMinPct = 3 / widthRatio
  const labelMaxPct = 100 - 3.5 / widthRatio

  return (
    <div
      aria-hidden
      className="text-foreground-faint relative h-7 text-[10px] tabular-nums"
    >
      {ticks.map(({ sec, kind }) => {
        const pct = (sec / spanSec) * 100
        const showLabel =
          kind === "major" &&
          (sec === 0 || (pct > labelMinPct && pct < labelMaxPct))
        return (
          <div
            key={sec}
            className={cn(
              "absolute bottom-0 flex flex-col items-center justify-end gap-0.5",
              sec > 0 && "-translate-x-1/2",
            )}
            style={{ left: `${pct}%` }}
          >
            {showLabel ? (
              <span className="leading-none whitespace-nowrap">
                {formatRulerSec(sec)}
              </span>
            ) : null}
            <span
              className={cn(
                "w-px",
                kind === "major"
                  ? "bg-foreground-faint h-2"
                  : kind === "mid"
                    ? "bg-border h-1.5"
                    : "bg-border/60 h-1",
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
