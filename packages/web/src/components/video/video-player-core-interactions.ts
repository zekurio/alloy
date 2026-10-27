import { useCallback } from "react"
import type { MouseEvent } from "react"

import type { PlayerStore } from "./video-player-store"

export function useControlledVideoClick({
  store,
  clearChromeHideTimer,
  isCoarsePointer,
  onVideoClick,
  scheduleChromeHide,
  setChromeVisible,
  togglePlay,
}: {
  store: PlayerStore
  clearChromeHideTimer: () => void
  isCoarsePointer: boolean
  onVideoClick: ((event: MouseEvent<HTMLVideoElement>) => void) | undefined
  scheduleChromeHide: () => void
  setChromeVisible: (visible: boolean) => void
  togglePlay: () => void
}) {
  return useCallback(
    (event: MouseEvent<HTMLVideoElement>) => {
      onVideoClick?.(event)
      if (isCoarsePointer) {
        const next = !store.getState().chromeVisible
        setChromeVisible(next)
        if (next) scheduleChromeHide()
        else clearChromeHideTimer()
        return
      }
      setChromeVisible(true)
      togglePlay()
    },
    [
      clearChromeHideTimer,
      isCoarsePointer,
      onVideoClick,
      scheduleChromeHide,
      setChromeVisible,
      store,
      togglePlay,
    ],
  )
}

export function useVideoChromePointerHandlers({
  store,
  clearChromeHideTimer,
  isCoarsePointer,
  scheduleChromeHide,
  setChromeVisible,
}: {
  store: PlayerStore
  clearChromeHideTimer: () => void
  isCoarsePointer: boolean
  scheduleChromeHide: () => void
  setChromeVisible: (visible: boolean) => void
}) {
  const handlePointerMove = useCallback(() => {
    if (isCoarsePointer) return
    setChromeVisible(true)
    if (store.getState().playing) scheduleChromeHide()
  }, [isCoarsePointer, scheduleChromeHide, setChromeVisible, store])

  const handlePointerLeave = useCallback(() => {
    if (isCoarsePointer) return
    clearChromeHideTimer()
    setChromeVisible(false)
  }, [clearChromeHideTimer, isCoarsePointer, setChromeVisible])

  return { handlePointerMove, handlePointerLeave }
}
