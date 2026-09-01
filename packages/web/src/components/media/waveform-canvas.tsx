import { cn } from "@alloy/ui/lib/utils"
import { useLayoutEffect, useEffect, useRef, useState } from "react"

import type { MediaWaveformStatus } from "@/lib/media-waveform"

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
    context.strokeStyle = "rgba(255, 255, 255, 0.22)"
    context.lineWidth = 1
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
    context.fillStyle = "rgba(255, 255, 255, 0.78)"

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
  }, [durationMs, endMs, peaks, size.height, size.width, startMs, status])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block size-full", className)}
    />
  )
}

function clampMs(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(durationMs, Math.max(0, value))
}
