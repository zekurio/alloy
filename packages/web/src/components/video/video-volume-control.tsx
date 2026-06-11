import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react"
import * as React from "react"

export function VolumeControl({
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  showSlider = true,
  className,
  iconClassName,
  iconGlyphClassName,
  sliderClassName,
}: {
  muted: boolean
  volume: number
  onToggleMute: () => void
  onVolumeChange: (next: number) => void
  showSlider?: boolean
  /** Extra classes on the outer wrapper — useful when the control is placed in an external toolbar row (e.g. the upload trim controls). */
  className?: string
  /** Override the icon button styling (size, colors). */
  iconClassName?: string
  /** Override the Lucide icon glyph styling. */
  iconGlyphClassName?: string
  /** Override the vertical slider popover styling. */
  sliderClassName?: string
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const effective = muted ? 0 : volume
  const Icon =
    muted || volume === 0
      ? VolumeXIcon
      : volume < 0.5
        ? Volume1Icon
        : Volume2Icon

  const computeVolume = React.useCallback((clientY: number): number => {
    const rail = railRef.current
    if (!rail) return 0
    const rect = rail.getBoundingClientRect()
    const insetPx = 20
    const trackHeight = Math.max(1, rect.height - insetPx * 2)
    return Math.min(
      1,
      Math.max(0, (rect.bottom - insetPx - clientY) / trackHeight),
    )
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdRef.current = e.pointerId
    setDragging(true)
    onVolumeChange(computeVolume(e.clientY))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    onVolumeChange(computeVolume(e.clientY))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingIdRef.current = null
    setDragging(false)
  }

  return (
    <div
      data-video-player-control
      className={cn(
        "group/vol relative flex items-center select-none before:absolute before:bottom-full before:left-1/2 before:h-3 before:w-8 before:-translate-x-1/2 before:content-['']",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={onToggleMute}
        className={cn(
          "size-[52px] shrink-0 rounded-full text-foreground hover:bg-transparent hover:text-foreground hover:shadow-none focus-visible:ring-ring",
          iconClassName,
        )}
      >
        <Icon
          className={cn(
            "size-[18px] stroke-[1.8] drop-shadow-[0_0_6px_color-mix(in_oklab,var(--accent)_75%,transparent)]",
            iconGlyphClassName,
          )}
        />
      </Button>

      {showSlider ? (
        <div
          ref={railRef}
          data-dragging={dragging || undefined}
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(effective * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault()
              onVolumeChange(Math.max(0, effective - 0.1))
            } else if (e.key === "ArrowRight") {
              e.preventDefault()
              onVolumeChange(Math.min(1, effective + 0.1))
            } else if (e.key === "ArrowDown") {
              e.preventDefault()
              onVolumeChange(Math.max(0, effective - 0.1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              onVolumeChange(Math.min(1, effective + 0.1))
            }
          }}
          className={cn(
            "absolute bottom-[calc(100%+0.45rem)] left-1/2 z-10 flex h-32 w-10 -translate-x-1/2 cursor-pointer touch-none items-center justify-center overflow-visible rounded-full py-5",
            "border border-white/15 bg-[oklch(12%_0.01_250)]/60 opacity-0 shadow-[0_18px_54px_-18px_rgb(0_0_0_/_0.72)] ring-1 ring-[oklch(12%_0.01_250)]/15 backdrop-blur-xl transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "pointer-events-none translate-y-0 group-hover/vol:pointer-events-auto group-hover/vol:-translate-y-1 group-hover/vol:opacity-100",
            "focus-within:pointer-events-auto focus-within:-translate-y-1 focus-within:opacity-100",
            "data-[dragging=true]:pointer-events-auto data-[dragging=true]:-translate-y-1 data-[dragging=true]:opacity-100",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            sliderClassName,
          )}
        >
          <div
            aria-hidden
            className="absolute inset-y-5 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-white/25"
          />
          <div
            aria-hidden
            className="bg-accent absolute bottom-5 left-1/2 w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_14px_color-mix(in_oklab,var(--accent)_70%,transparent)]"
            style={{ height: `calc(${effective} * (100% - 40px))` }}
          />
          <div
            aria-hidden
            // Same primitive as the progress scrubber's knob: a plain
            // 10px accent dot, centred on its position.
            className="bg-accent absolute left-1/2 size-[10px] -translate-x-1/2 translate-y-1/2 rounded-full"
            style={{
              bottom: `calc(20px + ${effective} * (100% - 40px))`,
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
