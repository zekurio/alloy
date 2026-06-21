import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { filmstripCellsForRange } from "@/lib/media-filmstrip"

interface FilmstripCanvasProps {
  frames: string[]
  cellCount: number
  durationMs: number
  startMs?: number
  endMs?: number
  className?: string
}

const frameImageCache = new Map<string, Promise<HTMLImageElement>>()

/**
 * Paints a filmstrip into one canvas instead of mounting one <img> per cell.
 * The extracted frame URLs are still shared by source, but the timeline no
 * longer asks the browser to layout and decode hundreds of repeated image
 * elements while zooming or dragging.
 */
export function FilmstripCanvas({
  frames,
  cellCount,
  durationMs,
  startMs,
  endMs,
  className,
}: FilmstripCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const cells = useMemo(
    () =>
      filmstripCellsForRange({
        frames,
        cellCount,
        durationMs,
        startMs,
        endMs,
      }),
    [cellCount, durationMs, endMs, frames, startMs],
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const readSize = () => {
      const rect = canvas.getBoundingClientRect()
      setSize((current) => {
        if (current.width === rect.width && current.height === rect.height) {
          return current
        }
        return { width: rect.width, height: rect.height }
      })
    }

    readSize()
    const observer = new ResizeObserver(readSize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext("2d")
    if (!context) return

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(size.width * dpr))
    const height = Math.max(1, Math.round(size.height * dpr))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    if (cells.length === 0 || !(size.width > 0) || !(size.height > 0)) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let cancelled = false
    void Promise.all(
      cells.map((src) => loadFrameImage(src).catch(() => null)),
    ).then((images) => {
      if (cancelled) return

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.save()
      context.scale(dpr, dpr)
      for (let i = 0; i < images.length; i++) {
        const image = images[i]
        if (!image) continue
        const x = (i / images.length) * size.width
        const nextX = ((i + 1) / images.length) * size.width
        drawImageCover(context, image, x, 0, nextX - x, size.height)
      }
      context.restore()
    })

    return () => {
      cancelled = true
    }
  }, [cells, size.height, size.width])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block size-full", className)}
    />
  )
}

function loadFrameImage(src: string): Promise<HTMLImageElement> {
  let pending = frameImageCache.get(src)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = "async"
      image.onload = () => {
        void image
          .decode()
          .catch(() => undefined)
          .then(() => resolve(image))
      }
      image.onerror = () => reject(new Error("Filmstrip frame failed to load"))
      image.src = src
    }).catch((cause) => {
      frameImageCache.delete(src)
      throw cause
    })
    frameImageCache.set(src, pending)
  }
  return pending
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceWidth = image.naturalWidth
  const sourceHeight = image.naturalHeight
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(width > 0)) return

  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = width / height
  let sx = 0
  let sy = 0
  let sw = sourceWidth
  let sh = sourceHeight

  if (sourceAspect > targetAspect) {
    sw = sourceHeight * targetAspect
    sx = (sourceWidth - sw) / 2
  } else if (sourceAspect < targetAspect) {
    sh = sourceWidth / targetAspect
    sy = (sourceHeight - sh) / 2
  }

  context.drawImage(image, sx, sy, sw, sh, x, y, width, height)
}
