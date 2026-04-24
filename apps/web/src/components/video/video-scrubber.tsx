import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function VideoScrubber({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
}: {
  currentTime: number
  duration: number
  bufferedEnd: number
  onSeek: (sec: number) => void
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const buffered = duration > 0 ? (bufferedEnd / duration) * 100 : 0

  const secFromClientX = React.useCallback(
    (clientX: number): number => {
      const rail = railRef.current
      if (!rail || duration <= 0) return 0
      const rect = rail.getBoundingClientRect()
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return pct * duration
    },
    [duration]
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
        "group/scrub relative h-1 w-full cursor-pointer touch-none rounded-full",
        "bg-neutral-200",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-neutral-300"
        style={{ width: `${buffered}%` }}
      />
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-accent"
        style={{ width: `${progress}%` }}
      />
      <div
        aria-hidden
        className={cn(
          "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
          "bg-accent shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)]",
          "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/bar:opacity-100 group-focus-visible/scrub:opacity-100"
        )}
        style={{ left: `${progress}%` }}
      />
    </div>
  )
}
