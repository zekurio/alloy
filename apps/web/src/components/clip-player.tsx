import * as React from "react"
import {
  MaximizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  SettingsIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * ClipPlayer — mock 16:9 video surface with Alloy-styled controls.
 *
 * Presentational only (no real <video> element) — the play / seek / volume
 * state is local so the controls feel alive in the preview. The thumbnail
 * accepts the same `accentHue` gradient trick as `ClipCard` so it matches
 * clips across the app when no real thumbnail is supplied.
 */
interface ClipPlayerProps extends React.ComponentProps<"div"> {
  title: string
  game: string
  duration?: string // e.g. "0:48"
  quality?: string // e.g. "1080p60"
  thumbnail?: string
  accentHue?: number
}

function ClipPlayer({
  className,
  title,
  game,
  duration = "0:48",
  quality = "1080p60",
  thumbnail,
  accentHue = 220,
  ...props
}: ClipPlayerProps) {
  const [playing, setPlaying] = React.useState(true)
  const [muted, setMuted] = React.useState(false)
  const [progress, setProgress] = React.useState(34) // percent

  return (
    <div
      data-slot="clip-player"
      className={cn(
        "group/clip-player relative aspect-video w-full overflow-hidden rounded-md",
        "bg-neutral-0 shadow-[0_0_0_1px_var(--border)]",
        className
      )}
      {...props}
    >
      {/* Thumbnail / video surface */}
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={title}
          className="size-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, oklch(0.32 0.12 ${accentHue}) 0%, oklch(0.16 0.06 ${accentHue}) 70%, oklch(0.08 0 0) 100%)`,
          }}
        />
      )}

      {/* Top-left: live/clip metadata */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent">Clip</Badge>
          <Badge variant="default">{quality}</Badge>
        </div>
        <Badge variant="default" className="font-mono">
          {game}
        </Badge>
      </div>

      {/* Big centre play button — only when paused */}
      {!playing && (
        <button
          type="button"
          aria-label="Play"
          onClick={() => setPlaying(true)}
          className={cn(
            "absolute inset-0 grid place-items-center",
            "bg-[color-mix(in_oklab,var(--neutral-0)_40%,transparent)]",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          )}
        >
          <span
            className={cn(
              "grid size-14 place-items-center rounded-full",
              "bg-accent text-accent-foreground",
              "shadow-[0_0_0_6px_var(--accent-soft),0_12px_32px_-8px_var(--accent-glow)]",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "group-hover/clip-player:scale-105"
            )}
          >
            <PlayIcon className="size-5 translate-x-[1px]" />
          </span>
        </button>
      )}

      {/* Bottom gradient + controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-2 px-4 pt-10 pb-3",
          "bg-[linear-gradient(to_top,oklch(0.08_0_0/0.85)_0%,oklch(0.08_0_0/0.4)_60%,transparent_100%)]"
        )}
      >
        {/* Scrubber */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = ((e.clientX - rect.left) / rect.width) * 100
            setProgress(Math.max(0, Math.min(100, pct)))
          }}
          className={cn(
            "group/scrub relative h-1 w-full cursor-pointer rounded-full",
            "bg-[color-mix(in_oklab,var(--neutral-900)_18%,transparent)]",
            "transition-[height] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:h-[5px]"
          )}
        >
          {/* Buffered */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--neutral-900)_32%,transparent)]"
            style={{ width: `${Math.min(100, progress + 18)}%` }}
          />
          {/* Played */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            aria-hidden
            className={cn(
              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full",
              "bg-accent shadow-[0_0_0_3px_var(--accent-soft)]",
              "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "group-hover/scrub:opacity-100"
            )}
            style={{ left: `${progress}%` }}
          />
        </div>

        {/* Control row */}
        <div className="flex items-center gap-2 text-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
            className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted((m) => !m)}
            className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
          >
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>

          <span className="font-mono text-2xs tracking-[0.06em] text-foreground">
            <span className="text-accent">
              {formatTime(progress, duration)}
            </span>
            <span className="mx-1 text-foreground-faint">/</span>
            <span className="text-foreground-muted">{duration}</span>
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
            >
              <SettingsIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Picture-in-picture"
              className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
            >
              <PictureInPicture2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Fullscreen"
              className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
            >
              <MaximizeIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Convert % progress into a mm:ss string based on the clip's total duration.
function formatTime(percent: number, total: string): string {
  const [m, s] = total.split(":").map((n) => Number.parseInt(n, 10) || 0)
  const totalSec = m * 60 + s
  const current = Math.floor((percent / 100) * totalSec)
  const mm = Math.floor(current / 60)
  const ss = current % 60
  return `${mm}:${ss.toString().padStart(2, "0")}`
}

export { ClipPlayer, type ClipPlayerProps }
