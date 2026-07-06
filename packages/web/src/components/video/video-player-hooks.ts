import { useCallback, useEffect, useRef, useState } from "react"

// Owns the chrome bar's visibility plus the auto-hide timer. Kept out of
// PlayerCore so the timer ref and its scheduling can't be poked from unrelated
// code paths; the auto-hide effect and pointer handlers stay in the player and
// drive it through the returned setters.
export function useVideoChromeVisibility(isCoarsePointer: boolean) {
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeHideTimerRef = useRef<number | null>(null)

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current === null) return
    window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = null
  }, [])

  const scheduleChromeHide = useCallback(
    (delayMs = isCoarsePointer ? 2600 : 1600) => {
      clearChromeHideTimer()
      chromeHideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false)
        chromeHideTimerRef.current = null
      }, delayMs)
    },
    [clearChromeHideTimer, isCoarsePointer],
  )

  return {
    chromeVisible,
    setChromeVisible,
    scheduleChromeHide,
    clearChromeHideTimer,
  }
}

const PLAY_THRESHOLD_CAP_SEC = 10
const PLAY_THRESHOLD_FRACTION = 0.5

export function usePlayingTimeSync(
  playing: boolean,
  syncTime: () => void,
): void {
  useEffect(() => {
    if (!playing) return
    let rafId = 0
    const tick = () => {
      syncTime()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing, syncTime])
}

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
  const callbackRef = useRef(onPlayThreshold)
  useEffect(() => {
    callbackRef.current = onPlayThreshold
  }, [onPlayThreshold])

  const firedRef = useRef(false)
  const accumulatedMsRef = useRef(0)
  const lastTickAtRef = useRef<number | null>(null)

  useEffect(() => {
    firedRef.current = false
    accumulatedMsRef.current = 0
    lastTickAtRef.current = null
  }, [identity])

  useEffect(() => {
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
        base * PLAY_THRESHOLD_FRACTION,
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
