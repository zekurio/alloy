import { t } from "@alloy/i18n"
import { Input } from "@alloy/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent } from "react"

import { hexToHsv, type Hsv, hsvToHex, normalizeHex } from "@/lib/color"

const DEFAULT_PRESETS = [
  "#d0c4eb",
  "#f7768e",
  "#ff9e64",
  "#e0af68",
  "#9ece6a",
  "#73daca",
  "#7dcfff",
  "#bb9af7",
] as const

type ColorPickerProps = {
  /** Current color as a hex string. */
  value: string
  /** Fires live as the color changes (drag, hex entry, preset). */
  onChange: (hex: string) => void
  presets?: readonly string[]
  disabled?: boolean
  /** Extra classes for the swatch trigger button. */
  triggerClassName?: string
  "aria-label"?: string
}

/** Reads normalized [0,1] pointer coordinates within an element while dragging. */
function useNormDrag(onMove: (nx: number, ny: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const sample = useCallback((clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nx = rect.width ? (clientX - rect.left) / rect.width : 0
    const ny = rect.height ? (clientY - rect.top) / rect.height : 0
    onMoveRef.current(
      Math.min(1, Math.max(0, nx)),
      Math.min(1, Math.max(0, ny)),
    )
  }, [])

  return {
    ref,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      sample(e.clientX, e.clientY)
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.buttons === 0) return
      sample(e.clientX, e.clientY)
    },
  }
}

/**
 * A pretty, reusable HEX color picker: a swatch button that opens a popover
 * with a saturation/value square, a hue slider, a hex field, and presets.
 * Controlled via `value`/`onChange`; emits canonical `#rrggbb`.
 */
export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  disabled,
  triggerClassName,
  "aria-label": ariaLabel,
}: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value) ?? { h: 260, s: 0.3, v: 0.85 },
  )
  const [hexText, setHexText] = useState(() => normalizeHex(value) ?? value)
  const lastHexRef = useRef(normalizeHex(value) ?? "")

  // Adopt external value changes (e.g. an "Auto" reset) without clobbering
  // in-progress local edits.
  useEffect(() => {
    const norm = normalizeHex(value)
    if (!norm || norm === lastHexRef.current) return
    const next = hexToHsv(norm)
    if (next) {
      lastHexRef.current = norm
      setHsv(next)
      setHexText(norm)
    }
  }, [value])

  const commit = useCallback(
    (next: Hsv) => {
      const hex = hsvToHex(next)
      lastHexRef.current = hex
      setHsv(next)
      setHexText(hex)
      onChange(hex)
    },
    [onChange],
  )

  const svDrag = useNormDrag((nx, ny) => commit({ ...hsv, s: nx, v: 1 - ny }))
  const hueDrag = useNormDrag((nx) => commit({ ...hsv, h: nx * 360 }))

  const current = hsvToHex(hsv)
  const hueColor = `hsl(${Math.round(hsv.h)}, 100%, 50%)`

  function handleHexInput(raw: string) {
    setHexText(raw)
    const norm = normalizeHex(raw)
    if (!norm) return
    const next = hexToHsv(norm)
    if (next) {
      lastHexRef.current = norm
      setHsv(next)
      onChange(norm)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel ?? "Pick a color"}
        className={cn(
          "ring-border focus-visible:ring-ring inline-flex size-9 shrink-0 rounded-md ring-1 transition-shadow focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
          triggerClassName,
        )}
        style={{ background: current }}
      />
      <PopoverContent className="w-64 gap-3">
        {/* Saturation / value field */}
        <div
          ref={svDrag.ref}
          onPointerDown={svDrag.onPointerDown}
          onPointerMove={svDrag.onPointerMove}
          className="relative h-36 w-full cursor-crosshair touch-none overflow-hidden rounded-md"
          style={{ background: hueColor }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, #fff, rgba(255,255,255,0))",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to top, #000, rgba(0,0,0,0))",
            }}
          />
          <span
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>

        {/* Hue slider */}
        <div
          ref={hueDrag.ref}
          onPointerDown={hueDrag.onPointerDown}
          onPointerMove={hueDrag.onPointerMove}
          className="relative h-3 w-full cursor-pointer touch-none rounded-full"
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }}
          />
        </div>

        {/* Hex field */}
        <div className="flex items-center gap-2">
          <span
            className="ring-border size-9 shrink-0 rounded-md ring-1"
            style={{ background: current }}
          />
          <Input
            value={hexText}
            onChange={(e) => handleHexInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            maxLength={7}
            className="font-mono uppercase"
            aria-label={t("Hex color value")}
          />
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                const next = hexToHsv(preset)
                if (next) commit(next)
              }}
              aria-label={preset}
              className="ring-border/60 hover:ring-foreground/40 size-6 rounded-md ring-1 transition-shadow"
              style={{ background: preset }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
