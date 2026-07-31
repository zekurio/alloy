import { ColorSwatch } from "@alloy/ui/components/color-swatch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import {
  formatCssColor,
  hsvaToRgba,
  hueColor,
  parseCssColor,
  rgbaToHsva,
  type Hsva,
} from "@alloy/ui/lib/color"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useMemo, useRef } from "react"
import type { CSSProperties, PointerEvent, RefObject } from "react"

const FALLBACK: Hsva = { h: 0, s: 0, v: 0, a: 1 }

/**
 * Colour picker owned end to end: a saturation/value field, hue and alpha
 * rails, and a swatch trigger. Replaces `<input type="color">`, which can't
 * show alpha, can't represent the `oklch()`/`rgba()` values the theme tokens
 * actually use, and renders differently in every browser.
 */
export function ColorPicker({
  value,
  onValueChange,
  label,
  disabled,
  className,
}: {
  /** Any CSS colour. Unparseable values open the picker on black. */
  value: string
  onValueChange: (next: string) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const hsva = useMemo(() => {
    const rgba = parseCssColor(value)
    return rgba ? rgbaToHsva(rgba) : FALLBACK
  }, [value])

  const emit = useCallback(
    (next: Hsva) => onValueChange(formatCssColor(hsvaToRgba(next))),
    [onValueChange],
  )

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          "border-border hover:border-border-strong focus-visible:ring-ring focus-visible:ring-offset-background size-9 shrink-0 rounded-md border p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 sm:size-8",
          className,
        )}
      >
        <ColorSwatch color={value} className="rounded-sm border-0" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 gap-3">
        <SaturationField
          hsva={hsva}
          onChange={(s, v) => emit({ ...hsva, s, v })}
        />
        <Rail
          label={label}
          kind="hue"
          position={hsva.h / 360}
          trackStyle={{
            background:
              "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          }}
          thumbColor={hueColor(hsva.h)}
          onChange={(ratio) => emit({ ...hsva, h: ratio * 360 })}
        />
        <Rail
          label={label}
          kind="alpha"
          position={hsva.a}
          trackStyle={{
            background: `linear-gradient(to right, transparent, ${formatCssColor(hsvaToRgba({ ...hsva, a: 1 }))})`,
          }}
          thumbColor={value}
          onChange={(ratio) => emit({ ...hsva, a: ratio })}
        />
      </PopoverContent>
    </Popover>
  )
}

function SaturationField({
  hsva,
  onChange,
}: {
  hsva: Hsva
  onChange: (s: number, v: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const track = useDragTrack(ref, (x, y) => onChange(x, 1 - y))

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Saturation and brightness"
      className="relative h-32 w-full cursor-crosshair touch-none rounded-md"
      style={{ background: hueColor(hsva.h) }}
      onPointerDown={track}
    >
      <div className="absolute inset-0 rounded-md bg-[linear-gradient(to_right,#fff,transparent)]" />
      <div className="absolute inset-0 rounded-md bg-[linear-gradient(to_top,#000,transparent)]" />
      <Thumb
        color={formatCssColor(hsvaToRgba({ ...hsva, a: 1 }))}
        style={{
          left: `${hsva.s * 100}%`,
          top: `${(1 - hsva.v) * 100}%`,
        }}
      />
    </div>
  )
}

function Rail({
  label,
  kind,
  position,
  trackStyle,
  thumbColor,
  onChange,
}: {
  label: string
  kind: "hue" | "alpha"
  position: number
  trackStyle: CSSProperties
  thumbColor: string
  onChange: (ratio: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const track = useDragTrack(ref, (x) => onChange(x))

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={`${label} ${kind}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      tabIndex={0}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full"
      style={
        kind === "alpha"
          ? {
              background:
                "repeating-conic-gradient(oklch(0.5 0 0 / 0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px",
            }
          : trackStyle
      }
      onPointerDown={track}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.01
        if (event.key === "ArrowLeft") onChange(Math.max(0, position - step))
        if (event.key === "ArrowRight") onChange(Math.min(1, position + step))
      }}
    >
      {kind === "alpha" ? (
        <div className="absolute inset-0 rounded-full" style={trackStyle} />
      ) : null}
      <Thumb
        color={thumbColor}
        style={{ left: `${position * 100}%`, top: "50%" }}
      />
    </div>
  )
}

function Thumb({ color, style }: { color: string; style: CSSProperties }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_oklch(0_0_0/0.5)]"
      style={{ ...style, background: color }}
    />
  )
}

/**
 * Pointer capture on the track element, so a drag that leaves the popup keeps
 * updating instead of stopping at the edge. Reports 0-1 on both axes.
 */
function useDragTrack(
  ref: RefObject<HTMLDivElement | null>,
  onMove: (x: number, y: number) => void,
) {
  return useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const element = ref.current
      if (!element) return

      const update = (clientX: number, clientY: number) => {
        const rect = element.getBoundingClientRect()
        const clamp = (n: number) => Math.min(1, Math.max(0, n))
        onMove(
          clamp((clientX - rect.left) / rect.width),
          clamp((clientY - rect.top) / rect.height),
        )
      }

      element.setPointerCapture(event.pointerId)
      update(event.clientX, event.clientY)

      const move = (next: globalThis.PointerEvent) =>
        update(next.clientX, next.clientY)
      const stop = () => {
        element.removeEventListener("pointermove", move)
        element.removeEventListener("pointerup", stop)
        element.removeEventListener("pointercancel", stop)
      }
      element.addEventListener("pointermove", move)
      element.addEventListener("pointerup", stop)
      element.addEventListener("pointercancel", stop)
    },
    [onMove, ref],
  )
}
