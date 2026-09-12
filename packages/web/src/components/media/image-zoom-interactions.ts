import {
  useEffect,
  useEffectEvent,
  useRef,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react"

export type ImageZoomOffset = { x: number; y: number }

type Gesture = { distance: number; zoom: number }
type Drag = { id: number; x: number; y: number; offset: ImageZoomOffset }

type ZoomState = {
  zoom: number
  offset: ImageZoomOffset
  setZoom: Dispatch<SetStateAction<number>>
  setOffset: Dispatch<SetStateAction<ImageZoomOffset>>
  onPinchStart?: () => void
}

type ZoomRefs = {
  viewportRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  pinching: RefObject<boolean>
  gesture: RefObject<Gesture | null>
  drag: RefObject<Drag | null>
}

export function useImageZoomInteractions(state: ZoomState) {
  const refs = useImageZoomGestureState(state)
  const pan = useImageZoomPan({
    ...state,
    viewportRef: refs.viewportRef,
    contentRef: refs.contentRef,
    pinching: refs.pinching,
    drag: refs.drag,
  })
  return {
    viewportRef: refs.viewportRef,
    contentRef: refs.contentRef,
    ...pan,
  }
}

function useImageZoomGestureState({
  zoom,
  offset,
  setZoom,
  setOffset,
  onPinchStart,
}: ZoomState): ZoomRefs {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinching = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  const drag = useRef<Drag | null>(null)
  const zoomAt = useEffectEvent(
    (next: number, clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content) return
      const nextZoom = zoomAtPoint(
        viewport,
        content,
        zoom,
        offset,
        next,
        clientX,
        clientY,
      )
      setOffset(nextZoom.offset)
      setZoom(nextZoom.zoom)
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
  return { viewportRef, contentRef, pinching, gesture, drag }
}

function useImageZoomPan({
  zoom,
  offset,
  setOffset,
  viewportRef,
  contentRef,
  pinching,
  drag,
}: ZoomState &
  Pick<ZoomRefs, "viewportRef" | "contentRef" | "pinching" | "drag">) {
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
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

export function clampZoom(value: number) {
  return Math.max(1, Math.min(4, value))
}

function zoomAtPoint(
  viewport: HTMLDivElement,
  content: HTMLDivElement,
  zoom: number,
  offset: ImageZoomOffset,
  next: number,
  clientX: number,
  clientY: number,
) {
  const rect = viewport.getBoundingClientRect()
  const target = clampZoom(next)
  const factor = target / zoom
  const x = clientX - rect.left - rect.width / 2
  const y = clientY - rect.top - rect.height / 2
  const maxX = Math.max(0, (content.offsetWidth * target - rect.width) / 2)
  const maxY = Math.max(0, (content.offsetHeight * target - rect.height) / 2)
  return {
    zoom: target,
    offset: {
      x: Math.max(-maxX, Math.min(maxX, x - (x - offset.x) * factor)),
      y: Math.max(-maxY, Math.min(maxY, y - (y - offset.y) * factor)),
    },
  }
}
