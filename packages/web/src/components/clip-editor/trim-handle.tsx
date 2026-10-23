import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import type { KeyboardEvent } from "react"

import { formatTrimMs } from "@/lib/media-time"

/** Arrow-key step for a trim control: 100ms, or a second with Shift. */
export function trimNudgeMs(e: KeyboardEvent<HTMLElement>): number | null {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null
  const stepMs = e.shiftKey ? 1000 : 100
  return e.key === "ArrowLeft" ? -stepMs : stepMs
}

/**
 * Grab bar at one end of the kept range. The `bar` variant is the slim edge
 * of the desktop trim bar; `timeline` is wide enough for a fingertip.
 */
export function TrimHandle({
  edge,
  valueMs,
  durationMs,
  variant,
  disabled,
  onKeyDown,
}: {
  edge: "start" | "end"
  valueMs: number
  durationMs: number
  variant: "bar" | "timeline"
  disabled?: boolean
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  const start = edge === "start"
  return (
    <div
      data-trim-handle={edge}
      role="slider"
      aria-label={start ? t("Trim start") : t("Trim end")}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(valueMs / 1000)}
      aria-valuetext={formatTrimMs(valueMs)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      className={cn(
        "bg-accent absolute inset-y-0 flex cursor-ew-resize items-center justify-center",
        start ? "left-0" : "right-0",
        // Widen the hit area beyond the visible grip.
        "after:absolute after:inset-y-0",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        variant === "bar"
          ? cn(
              "z-20 w-2.5 after:-inset-x-1.5",
              start ? "rounded-l-md" : "rounded-r-md",
            )
          : cn(
              "z-10 w-6 after:-inset-x-2",
              start ? "rounded-l-sm" : "rounded-r-sm",
            ),
      )}
    >
      <span
        className={cn(
          "bg-accent-foreground/80 rounded-full",
          variant === "bar" ? "h-5 w-0.5" : "h-8 w-1",
        )}
      />
    </div>
  )
}
