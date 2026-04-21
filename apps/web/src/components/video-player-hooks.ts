import * as React from "react"

const PLAY_THRESHOLD_CAP_SEC = 10
const PLAY_THRESHOLD_FRACTION = 0.5

export function usePlayThreshold({
  playing,
  duration,
  identity,
  onPlayThreshold,
}: {
  playing: boolean
  duration: number
  identity: string
  onPlayThreshold: (() => void) | undefined
}): void {
  const callbackRef = React.useRef(onPlayThreshold)
  React.useEffect(() => {
    callbackRef.current = onPlayThreshold
  }, [onPlayThreshold])

  const firedRef = React.useRef(false)
  const accumulatedMsRef = React.useRef(0)
  const lastTickAtRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    firedRef.current = false
    accumulatedMsRef.current = 0
    lastTickAtRef.current = null
  }, [identity])

  React.useEffect(() => {
    if (firedRef.current) return
    if (!callbackRef.current) return

    if (!playing) {
      const last = lastTickAtRef.current
      if (last !== null) {
        accumulatedMsRef.current += performance.now() - last
        lastTickAtRef.current = null
      }
      return
    }

    lastTickAtRef.current = performance.now()
    const interval = window.setInterval(() => {
      if (firedRef.current) return
      const last = lastTickAtRef.current
      if (last === null) return
      const now = performance.now()
      accumulatedMsRef.current += now - last
      lastTickAtRef.current = now

      const base = Number.isFinite(duration) && duration > 0 ? duration : 60
      const threshold = Math.min(
        PLAY_THRESHOLD_CAP_SEC,
        base * PLAY_THRESHOLD_FRACTION
      )
      if (accumulatedMsRef.current / 1000 >= threshold) {
        firedRef.current = true
        callbackRef.current?.()
      }
    }, 250)

    return () => {
      window.clearInterval(interval)
      const last = lastTickAtRef.current
      if (last !== null) {
        accumulatedMsRef.current += performance.now() - last
        lastTickAtRef.current = null
      }
    }
  }, [playing, duration])
}

export function formatTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00"
  const total = Math.floor(totalSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, "0")
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`
  return `${m}:${ss}`
}
