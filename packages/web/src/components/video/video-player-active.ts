import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import * as React from "react"

import {
  handleVideoKeyCommand,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-player-shell"

let activeVideoPlayerId: string | null = null

interface ActiveVideoPlayerOptions {
  autoPlay: boolean
  controls: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
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
  const playerId = React.useId()

  const activatePlayer = React.useCallback(() => {
    activeVideoPlayerId = playerId
  }, [playerId])

  const focusPlayerContainer = React.useCallback(() => {
    activatePlayer()
    containerRef.current?.focus({ preventScroll: true })
  }, [activatePlayer, containerRef])

  const onKeyDown = React.useCallback(
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

  React.useEffect(() => {
    if (!autoPlay && controls) return
    activeVideoPlayerId = playerId
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
    }
  }, [autoPlay, controls, playerId])

  React.useEffect(() => {
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
      clearChromeHideTimer()
    }
  }, [clearChromeHideTimer, playerId])

  return { activatePlayer, focusPlayerContainer }
}
