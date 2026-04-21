import * as React from "react"
import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function VolumeControl({
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  className,
}: {
  muted: boolean
  volume: number
  onToggleMute: () => void
  onVolumeChange: (next: number) => void
  /** Extra classes on the outer wrapper — useful when the control is placed in an external toolbar row (e.g. the upload trim controls). */
  className?: string
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)

  const effective = muted ? 0 : volume
  const Icon =
    muted || volume === 0
      ? VolumeXIcon
      : volume < 0.5
        ? Volume1Icon
        : Volume2Icon

  const computeVolume = React.useCallback((clientX: number): number => {
    const rail = railRef.current
    if (!rail) return 0
    const rect = rail.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdRef.current = e.pointerId
    onVolumeChange(computeVolume(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    onVolumeChange(computeVolume(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingIdRef.current = null
  }

  return (
    <div className={cn("group/vol flex items-center", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={onToggleMute}
        className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
      >
        <Icon />
      </Button>

      <div
        ref={railRef}
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
          }
        }}
        className={cn(
          "relative h-1 cursor-pointer touch-none overflow-hidden rounded-full",
          "bg-[color-mix(in_oklab,var(--neutral-900)_18%,transparent)]",
          "w-0 opacity-0 transition-[width,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          // Reveal the rail when the mute button or the rail itself is
          // hovered/focused. The extra `focus-within` covers keyboard
          // users landing on the rail via Tab.
          "group-hover/vol:ml-1 group-hover/vol:w-16 group-hover/vol:opacity-100",
          "focus-within:ml-1 focus-within:w-16 focus-within:opacity-100",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${effective * 100}%` }}
        />
      </div>
    </div>
  )
}
