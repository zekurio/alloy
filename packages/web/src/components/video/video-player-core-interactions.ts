import { useCallback } from "react"
import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react"

export function useControlledVideoClick({
  clearChromeHideTimer,
  isCoarsePointer,
  onVideoClick,
  scheduleChromeHide,
  setChromeVisible,
  togglePlay,
}: {
  clearChromeHideTimer: () => void
  isCoarsePointer: boolean
  onVideoClick: ((event: MouseEvent<HTMLVideoElement>) => void) | undefined
  scheduleChromeHide: () => void
  setChromeVisible: Dispatch<SetStateAction<boolean>>
  togglePlay: () => void
}) {
  return useCallback(
    (event: MouseEvent<HTMLVideoElement>) => {
      onVideoClick?.(event)
      if (isCoarsePointer) {
        setChromeVisible((current) => {
          const next = !current
          if (next) scheduleChromeHide()
          else clearChromeHideTimer()
          return next
        })
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
      togglePlay,
    ],
  )
}

export function useVideoChromePointerHandlers({
  clearChromeHideTimer,
  isCoarsePointer,
  playingRef,
  scheduleChromeHide,
  setChromeVisible,
}: {
  clearChromeHideTimer: () => void
  isCoarsePointer: boolean
  playingRef: RefObject<boolean>
  scheduleChromeHide: () => void
  setChromeVisible: Dispatch<SetStateAction<boolean>>
}) {
  const handlePointerMove = useCallback(() => {
    if (isCoarsePointer) return
    setChromeVisible(true)
    if (playingRef.current) scheduleChromeHide()
  }, [isCoarsePointer, scheduleChromeHide])

  const handlePointerLeave = useCallback(() => {
    if (isCoarsePointer) return
    clearChromeHideTimer()
    setChromeVisible(false)
  }, [clearChromeHideTimer, isCoarsePointer])

  return { handlePointerMove, handlePointerLeave }
}
