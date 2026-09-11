import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Slider } from "@alloy/ui/components/slider"
import { cn } from "@alloy/ui/lib/utils"
import { MinusIcon, PlusIcon } from "lucide-react"
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
} from "react"

export function useImageZoom(onPinchStart?: () => void) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinching = useRef(false)
  const gesture = useRef<{ distance: number; zoom: number } | null>(null)
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
  const zoomAt = useEffectEvent(
    (next: number, clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content) return
      const rect = viewport.getBoundingClientRect()
      const target = Math.max(1, Math.min(4, next))
      const factor = target / zoom
      const x = clientX - rect.left - rect.width / 2
      const y = clientY - rect.top - rect.height / 2
      const maxX = Math.max(0, (content.offsetWidth * target - rect.width) / 2)
      const maxY = Math.max(
        0,
        (content.offsetHeight * target - rect.height) / 2,
      )
      setOffset({
        x: Math.max(-maxX, Math.min(maxX, x - (x - offset.x) * factor)),
        y: Math.max(-maxY, Math.min(maxY, y - (y - offset.y) * factor)),
      })
      setZoom(target)
    },
  )
  const wheelZoom = useEffectEvent((event: WheelEvent) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    zoomAt(zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY)
  })
  const touchZoom = useEffectEvent((event: TouchEvent) => {
    if (event.touches.length !== 2) return
    event.preventDefault()
    const [a, b] = Array.from(event.touches)
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (!gesture.current) {
      gesture.current = { distance: Math.max(1, distance), zoom }
      pinching.current = true
      drag.current = null
      onPinchStart?.()
    }
    zoomAt(
      (gesture.current.zoom * distance) / gesture.current.distance,
      (a.clientX + b.clientX) / 2,
      (a.clientY + b.clientY) / 2,
    )
  })
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => wheelZoom(event)
    const touch = (event: TouchEvent) => touchZoom(event)
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) gesture.current = null
      if (event.touches.length === 0) pinching.current = false
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    viewport.addEventListener("touchstart", touch, { passive: false })
    viewport.addEventListener("touchmove", touch, { passive: false })
    viewport.addEventListener("touchend", end)
    viewport.addEventListener("touchcancel", end)
    return () => {
      viewport.removeEventListener("wheel", wheel)
      viewport.removeEventListener("touchstart", touch)
      viewport.removeEventListener("touchmove", touch)
      viewport.removeEventListener("touchend", end)
      viewport.removeEventListener("touchcancel", end)
    }
  }, [])
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
      if (pinching.current) return
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
