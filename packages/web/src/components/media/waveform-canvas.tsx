import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { useLayoutEffect, useEffect, useRef, useState } from "react"

import type { MediaWaveformStatus } from "@/lib/media-waveform"

/** Peaks carry the strip; the centre line only suggests the zero crossing. */
const PEAK_ALPHA = 0.78
const LINE_ALPHA = 0.22

interface WaveformCanvasProps {
  peaks: Float32Array
  durationMs: number
  status: MediaWaveformStatus
  startMs?: number
  endMs?: number
  className?: string
}

/** Paints normalized audio peaks for the complete source or a visible range. */
export function WaveformCanvas({
  peaks,
  durationMs,
  status,
  startMs = 0,
  endMs = durationMs,
  className,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const themeRevision = useThemeRevision()

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
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!(size.width > 0) || !(size.height > 0)) return
    if (status !== "ready") return

    context.save()
    context.scale(dpr, dpr)
    // Canvas has no `currentColor`, so the waveform is painted in the
    // canvas' own text colour: the component styles it `text-foreground`
    // (callers can override), which keeps the ink readable on either palette.
    const ink = getComputedStyle(canvas).color
    context.strokeStyle = ink
    context.lineWidth = 1
    context.globalAlpha = LINE_ALPHA
    context.beginPath()
    context.moveTo(0, size.height / 2 + 0.5)
    context.lineTo(size.width, size.height / 2 + 0.5)
    context.stroke()

    const hasPeaks = peaks.length >= 2 && durationMs > 0
    if (!hasPeaks) {
      context.restore()
      return
    }

    const rangeStart = clampMs(startMs, durationMs)
    const rangeEnd = Math.max(rangeStart, clampMs(endMs, durationMs))
    const firstPeak = Math.max(
      0,
      Math.floor((rangeStart / durationMs) * (peaks.length / 2)),
    )
    const lastPeak = Math.min(
      peaks.length / 2,
      Math.max(
        firstPeak + 1,
        Math.ceil((rangeEnd / durationMs) * (peaks.length / 2)),
      ),
    )
    const peakCount = Math.max(1, lastPeak - firstPeak)
    const halfHeight = Math.max(1, size.height / 2 - 3)
    context.fillStyle = ink
    context.globalAlpha = PEAK_ALPHA

    for (let index = firstPeak; index < lastPeak; index++) {
      const minimum = peaks[index * 2] ?? 0
      const maximum = peaks[index * 2 + 1] ?? 0
      const x = ((index - firstPeak) / peakCount) * size.width
      const nextX = ((index - firstPeak + 1) / peakCount) * size.width
      const barWidth = Math.max(1, nextX - x)
      const top = Math.max(0, Math.min(1, maximum)) * halfHeight
      const bottom = Math.max(0, Math.min(1, -minimum)) * halfHeight
      const barHeight = Math.max(1, top + bottom)
      context.fillRect(x, size.height / 2 - top, barWidth, barHeight)
    }

    context.restore()
  }, [
    durationMs,
    endMs,
    peaks,
    size.height,
    size.width,
    startMs,
    status,
    themeRevision,
  ])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("text-foreground block size-full", className)}
    />
  )
}

/**
 * Canvas paints pixels, so it can't follow a palette swap through CSS the way
 * elements do. Returns a revision the paint effect depends on: a theme change
 * either swaps the attributes on the root or replaces the stylesheet overrides
 * that accents and presets write into the head.
 */
function useThemeRevision(): number {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setRevision((current) => current + 1)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-neutral"],
    })
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    return () => observer.disconnect()
  }, [])

  return revision
}

function clampMs(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(durationMs, Math.max(0, value))
}

export function WaveformStatus({ status }: { status: MediaWaveformStatus }) {
  if (status === "ready") return null
  const label = status === "loading" ? t("Loading…") : t("Unavailable")
  return (
    <span className="text-foreground-faint pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium tracking-wide uppercase">
      {label}
    </span>
  )
}
