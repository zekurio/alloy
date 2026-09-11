import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Slider } from "@alloy/ui/components/slider"
import { cn } from "@alloy/ui/lib/utils"
import { MinusIcon, PlusIcon } from "lucide-react"
import { useRef, useState, type PointerEvent } from "react"

export function useImageZoom() {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    id: number
    x: number
    y: number
    offset: typeof offset
  } | null>(null)
  const changeZoom = (next: number) => {
    setZoom(Math.max(1, Math.min(4, next)))
    setOffset({ x: 0, y: 0 })
  }
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    zoom,
    changeZoom,
    viewportRef,
    contentRef,
    style: {
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    },
    startPan: (event: PointerEvent<HTMLDivElement>) => {
      if (zoom === 1 || (event.button !== 0 && event.button !== 1)) return
      event.preventDefault()
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offset,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    movePan: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!start || start.id !== event.pointerId || !viewport || !content)
        return
      const maxX = Math.max(
        0,
        (content.offsetWidth * zoom - viewport.clientWidth) / 2,
      )
      const maxY = Math.max(
        0,
        (content.offsetHeight * zoom - viewport.clientHeight) / 2,
      )
      setOffset({
        x: Math.max(
          -maxX,
          Math.min(maxX, start.offset.x + event.clientX - start.x),
        ),
        y: Math.max(
          -maxY,
          Math.min(maxY, start.offset.y + event.clientY - start.y),
        ),
      })
    },
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
