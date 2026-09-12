import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Slider } from "@alloy/ui/components/slider"
import { cn } from "@alloy/ui/lib/utils"
import { MinusIcon, PlusIcon } from "lucide-react"
import { useState } from "react"

import {
  clampZoom,
  type ImageZoomOffset,
  useImageZoomInteractions,
} from "./image-zoom-interactions"

export function useImageZoom(onPinchStart?: () => void) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<ImageZoomOffset>({ x: 0, y: 0 })
  const { viewportRef, contentRef, startPan, movePan, endPan } =
    useImageZoomInteractions({
      zoom,
      offset,
      setZoom,
      setOffset,
      onPinchStart,
    })
  return {
    zoom,
    changeZoom: (next: number) => {
      setZoom(clampZoom(next))
      setOffset({ x: 0, y: 0 })
    },
    viewportRef,
    contentRef,
    style: {
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    },
    startPan,
    movePan,
    endPan,
  }
}

export function ImageZoomControls({
  zoom,
  onChange,
  disabled,
  floating = false,
}: {
  zoom: number
  onChange: (zoom: number) => void
  disabled?: boolean
  floating?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={t("Zoom")}
      className={cn(
        "flex shrink-0 items-center gap-1",
        floating &&
          "rounded-full border border-white/15 bg-black/55 px-2 py-1 text-white shadow-lg backdrop-blur-md",
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Zoom out")}
        disabled={disabled || zoom <= 1}
        onClick={() => onChange(zoom - 0.25)}
      >
        <MinusIcon />
      </Button>
      <div className="w-20 sm:w-24">
        <Slider
          aria-label={t("Zoom")}
          min={1}
          max={4}
          step={0.05}
          value={[zoom]}
          disabled={disabled}
          size="touch"
          onValueChange={(value) =>
            onChange(Array.isArray(value) ? value[0] : value)
          }
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Zoom in")}
        disabled={disabled || zoom >= 4}
        onClick={() => onChange(zoom + 0.25)}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-14 px-1 font-mono text-xs tabular-nums"
        aria-label={t("Fit image")}
        title={t("Fit image")}
        disabled={disabled}
        onClick={() => onChange(1)}
      >
        {Math.round(zoom * 100)}%
      </Button>
    </div>
  )
}
