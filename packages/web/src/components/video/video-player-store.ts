import { createContext, useContext } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import type { StoreApi } from "zustand/vanilla"

export type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

/**
 * Playback state for one player. Handlers read it through `getState()`, so
 * they never need ref mirrors; components select only the slices they render,
 * so the per-frame clock re-renders the timeline rather than the whole player.
 */
export type PlayerState = {
  status: LoadStatus
  buffering: boolean
  duration: number
  currentTime: number
  bufferedEnd: number
  playing: boolean
  playbackRate: number
  /**
   * The poster stands in for the media until the viewer's own frame is on
   * screen — playback starting, or a seek they asked for. The first decoded
   * frame is the media's opening frame, so uncovering it while the video is
   * still parked at the start swaps one still for another and reads as the
   * clip having two thumbnails.
   */
  posterHeld: boolean
  /** Whether the current source has put a frame on screen. */
  hasRenderedFrame: boolean
  chromeVisible: boolean
}

export type PlayerStore = StoreApi<PlayerState>

export function createPlayerStore(): PlayerStore {
  return createStore<PlayerState>()(() => ({
    status: { kind: "loading" },
    buffering: false,
    duration: 0,
    currentTime: 0,
    bufferedEnd: 0,
    playing: false,
    playbackRate: 1,
    posterHeld: true,
    hasRenderedFrame: false,
    chromeVisible: true,
  }))
}

const PlayerStoreContext = createContext<PlayerStore | null>(null)

export const PlayerStoreProvider = PlayerStoreContext.Provider

/** Selects a slice of the enclosing player's state. */
export function usePlayerState<T>(selector: (state: PlayerState) => T): T {
  const store = useContext(PlayerStoreContext)
  if (!store) {
    throw new Error("usePlayerState must be used inside a video player")
  }
  return useStore(store, selector)
}
