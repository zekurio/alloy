"use client"

import { useCallback, useSyncExternalStore } from "react"

const mediaQueryLists = new Map<string, MediaQueryList>()

function mediaQueryList(query: string): MediaQueryList | null {
  if (!globalThis.window?.matchMedia) return null
  let mql = mediaQueryLists.get(query)
  if (!mql) {
    mql = window.matchMedia(query)
    mediaQueryLists.set(query, mql)
  }
  return mql
}

function noMatch() {
  return false
}

export function useMediaQuery(query: string): boolean {
  // Read synchronously so the first render already reflects the viewport;
  // an effect-only update would flash the non-matching layout.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQueryList(query)
      mql?.addEventListener("change", onChange)
      return () => mql?.removeEventListener("change", onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(
    () => mediaQueryList(query)?.matches ?? false,
    [query],
  )

  return useSyncExternalStore(subscribe, getSnapshot, noMatch)
}
