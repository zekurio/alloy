import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

export function VideoScrubber({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
  variant = "default",
}: {
  currentTime: number
  duration: number
  bufferedEnd: number
  onSeek: (sec: number) => void
  /** "translucent" uses white-on-transparent track colours suitable for
   *  rails that sit on a plain dark background without a chrome surface. */
  variant?: "default" | "translucent" | "edge"
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const buffered = duration > 0 ? (bufferedEnd / duration) * 100 : 0

  // Shared geometry for the three stacked bar layers (track → buffer →
  // progress). The edge variant hugs the bottom as a thin 2px rail.
  const barLayerClass =
    variant === "edge" ? "bottom-0 h-[2px]" : "top-1/2 h-[4px] -translate-y-1/2"

  const secFromClientX = React.useCallback(
    (clientX: number): number => {
      const rail = railRef.current
      if (!rail || duration <= 0) return 0
      const rect = rail.getBoundingClientRect()
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return pct * duration
    },
    [duration],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdRef.current = e.pointerId
    onSeek(secFromClientX(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    onSeek(secFromClientX(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingIdRef.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      onSeek(Math.max(0, currentTime - 5))
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      onSeek(Math.min(duration, currentTime + 5))
    } else if (e.key === "Home") {
      e.preventDefault()
      onSeek(0)
    } else if (e.key === "End") {
      e.preventDefault()
      onSeek(duration)
    }
  }

  return (
    <div
      ref={railRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(duration))}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "group/scrub relative w-full cursor-pointer touch-none",
        variant === "edge" ? "h-3 rounded-none" : "h-3 rounded-full",
        "bg-transparent",
        variant !== "edge" &&
          "transition-[height] duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:h-2",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      {/* Layer 1 — full track (the whole bar). */}
      <div
        aria-hidden
        className={cn(
          "absolute left-0 w-full rounded-full",
          barLayerClass,
          variant === "edge" ? "bg-white/15" : "bg-white/20",
        )}
      />
      {/* Layer 2 — buffered range. Kept dim so the played bar clearly reads
          as the brightest of the three layers. */}
      <div
        aria-hidden
        className={cn(
          "absolute left-0 rounded-full",
          barLayerClass,
          variant === "edge" ? "bg-white/25" : "bg-white/30",
        )}
        style={{ width: `${buffered}%` }}
      />
      {/* Layer 3 — played progress. An accent glow lifts it off the buffered
          range even when the underlying frame is bright. */}
      <div
        aria-hidden
        className={cn(
          "absolute left-0 rounded-full bg-accent",
          barLayerClass,
          variant !== "edge" && "shadow-[0_0_8px_var(--accent-glow)]",
        )}
        style={{ width: `${progress}%` }}
      />
      {variant === "edge" ? null : (
        <div
          aria-hidden
          className={cn(
            "absolute top-1/2 size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full",
            "bg-accent",
            variant === "translucent"
              ? "opacity-100"
              : "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] group-hover/scrub:opacity-100 group-focus-visible/scrub:opacity-100",
          )}
          style={{ left: `${progress}%` }}
        />
      )}
    </div>
  )
}
