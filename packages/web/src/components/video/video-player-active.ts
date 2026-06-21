import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import { useCallback, useEffect, useId } from "react"
import type { RefObject } from "react"

import {
  handleVideoKeyCommand,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-player-shell"

let activeVideoPlayerId: string | null = null

interface ActiveVideoPlayerOptions {
  autoPlay: boolean
  controls: boolean
  containerRef: RefObject<HTMLDivElement | null>
  clearChromeHideTimer: () => void
  enableHorizontalSeekShortcuts: boolean
  keyCommand: VideoKeyCommand
}

export function useActiveVideoPlayer({
  autoPlay,
  controls,
  containerRef,
  clearChromeHideTimer,
  enableHorizontalSeekShortcuts,
  keyCommand,
}: ActiveVideoPlayerOptions): {
  activatePlayer: () => void
  focusPlayerContainer: () => void
} {
  const playerId = useId()

  const activatePlayer = useCallback(() => {
    activeVideoPlayerId = playerId
  }, [playerId])

  const focusPlayerContainer = useCallback(() => {
    activatePlayer()
    containerRef.current?.focus({ preventScroll: true })
  }, [activatePlayer, containerRef])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (activeVideoPlayerId !== playerId) return
      if (
        !shouldHandleGlobalVideoShortcut(event.target, containerRef.current)
      ) {
        return
      }
      if (
        handleVideoKeyCommand(event, keyCommand, {
          enableHorizontalSeek: enableHorizontalSeekShortcuts,
        })
      ) {
        containerRef.current?.focus({ preventScroll: true })
      }
    },
    [containerRef, enableHorizontalSeekShortcuts, keyCommand, playerId],
  )
  useWindowEvent("keydown", onKeyDown, true)

  useEffect(() => {
    if (!autoPlay && controls) return
    activeVideoPlayerId = playerId
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
    }
  }, [autoPlay, controls, playerId])

  useEffect(() => {
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
      clearChromeHideTimer()
    }
  }, [clearChromeHideTimer, playerId])

  return { activatePlayer, focusPlayerContainer }
}
