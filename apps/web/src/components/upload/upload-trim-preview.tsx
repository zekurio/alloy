import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/video/video-player"

function TrimHandle({
  side,
  onPointerDown,
  style,
}: {
  side: "start" | "end"
  onPointerDown: (e: React.PointerEvent) => void
  style: React.CSSProperties
}) {
  return (
    <button
      type="button"
      aria-label={side === "start" ? "Trim start" : "Trim end"}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-1 bottom-1 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-md",
        side === "start" ? "-ml-1.5" : "-mr-1.5",
        "bg-accent text-accent-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
        "hover:bg-accent-hover focus-visible:outline-none",
        "touch-none"
      )}
      style={style}
    >
      <span className="h-3.5 w-px rounded-full bg-accent-foreground/80" />
    </button>
  )
}

export function VideoPreview({
  file,
  trimStartMs,
  trimEndMs,
  isPlaying,
  currentMs,
  volume,
  muted,
  onTimeUpdate,
  onPlayingChange,
}: {
  file: File
  trimStartMs: number
  trimEndMs: number
  isPlaying: boolean
  currentMs: number
  volume: number
  muted: boolean
  onTimeUpdate: (ms: number) => void
  onPlayingChange: (playing: boolean) => void
}) {
  const playerRef = React.useRef<VideoPlayerHandle>(null)

  // Drive play/pause from the parent's `isPlaying`.
  React.useEffect(() => {
    const p = playerRef.current
    if (!p) return
    if (isPlaying) {
      // If we're sitting at/past the trim end, rewind to the start so
      // the play button restarts the trim window instead of being a no-op.
      if (p.getCurrentTime() * 1000 >= trimEndMs - 30) {
        p.seek(trimStartMs / 1000)
      }
      void p.play().catch(() => undefined)
    } else {
      p.pause()
    }
  }, [isPlaying, trimStartMs, trimEndMs])

  // Mirror volume + muted onto the player.
  React.useEffect(() => {
    const p = playerRef.current
    if (!p) return
    p.setVolume(volume)
    p.setMuted(muted)
  }, [volume, muted])

  // Parent → player seek. Only nudge when the parent's currentMs has
  // moved meaningfully, otherwise our own time-update handler would
  React.useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const playerMs = p.getCurrentTime() * 1000
    if (Math.abs(playerMs - currentMs) > 50) {
      p.seek(currentMs / 1000)
    }
  }, [currentMs])

  return (
    <div className="relative">
      <VideoPlayer
        src={file}
        controls={false}
        playerRef={playerRef}
        onVideoClick={() => onPlayingChange(!isPlaying)}
        onPlayingChange={onPlayingChange}
        onTimeUpdate={(t) => {
          onTimeUpdate(t * 1000)
          // next interaction is scrubbing, not watching the window spin.
          if (t * 1000 >= trimEndMs && isPlaying) {
            playerRef.current?.pause()
            onPlayingChange(false)
          }
        }}
      />
    </div>
  )
}

const MIN_TRIM_MS = 100

export function TrimTimeline({
  durationMs,
  trimStartMs,
  trimEndMs,
  currentMs,
  onTrimChange,
  onSeek,
}: {
  durationMs: number
  trimStartMs: number
  trimEndMs: number
  currentMs: number
  onTrimChange: (start: number, end: number) => void
  onSeek: (ms: number) => void
}) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const dragStateRef = React.useRef<{
    kind: "start" | "end" | "playhead"
    pointerId: number
    element: Element
  } | null>(null)

  const pctOf = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0

  const msFromClient = React.useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track) return 0
      const rect = track.getBoundingClientRect()
      const x = clientX - rect.left
      const pct = Math.min(1, Math.max(0, x / rect.width))
      return Math.round(pct * durationMs)
    },
    [durationMs]
  )

  const startDrag = (
    kind: "start" | "end" | "playhead",
    e: React.PointerEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    dragStateRef.current = { kind, pointerId: e.pointerId, element: target }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const ms = msFromClient(e.clientX)
    if (drag.kind === "start") {
      const next = Math.min(ms, trimEndMs - MIN_TRIM_MS)
      onTrimChange(Math.max(0, next), trimEndMs)
    } else if (drag.kind === "end") {
      const next = Math.max(ms, trimStartMs + MIN_TRIM_MS)
      onTrimChange(trimStartMs, Math.min(durationMs, next))
    } else {
      // playhead: stay inside the trim window so the player doesn't
      // drift outside the soon-to-be-encoded range.
      onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs))
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.element.hasPointerCapture(e.pointerId)) {
      drag.element.releasePointerCapture(e.pointerId)
    }
    dragStateRef.current = null
  }

  // Click on the track (away from the handles) seeks the playhead.
  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragStateRef.current) return
    const ms = msFromClient(e.clientX)
    onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs))
  }

  return (
    <div
      ref={trackRef}
      onClick={handleTrackClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "relative h-8 w-full",
        "rounded-lg border border-border bg-surface",
        "select-none"
      )}
    >
      {/* Base rail — dim track spanning the full duration. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground-faint/15"
      />

      {/* Selected-range fill — accent rail inside the trim window. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-accent"
        style={{
          left: `${pctOf(trimStartMs)}%`,
          right: `${100 - pctOf(trimEndMs)}%`,
        }}
      />

      <TrimHandle
        side="start"
        onPointerDown={(e) => startDrag("start", e)}
        style={{ left: `${pctOf(trimStartMs)}%` }}
      />
      <TrimHandle
        side="end"
        onPointerDown={(e) => startDrag("end", e)}
        style={{ left: `calc(${pctOf(trimEndMs)}% - 12px)` }}
      />

      {/* Playhead — only render when it's inside the trim window so it
          doesn't visually escape the highlighted range */}
      {currentMs >= trimStartMs && currentMs <= trimEndMs ? (
        <button
          type="button"
          aria-label="Playhead — drag to scrub"
          onPointerDown={(e) => startDrag("playhead", e)}
          className={cn(
            "absolute top-0 bottom-0 z-20 -ml-[1px] w-[2px] cursor-ew-resize bg-foreground",
            "shadow-[0_0_0_1px_rgba(0,0,0,0.3)]",
            "touch-none focus-visible:outline-none"
          )}
          style={{ left: `${pctOf(currentMs)}%` }}
        />
      ) : null}
    </div>
  )
}
