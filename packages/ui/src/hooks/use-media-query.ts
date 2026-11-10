import { useCallback, useSyncExternalStore } from "react"

const mediaQueryLists = new Map<string, MediaQueryList>()

function mediaQueryList(query: string): MediaQueryList {
  let mql = mediaQueryLists.get(query)
  if (!mql) {
    mql = window.matchMedia(query)
    mediaQueryLists.set(query, mql)
  }
  return mql
}

export function useMediaQuery(query: string): boolean {
  // Read synchronously so the first render already reflects the viewport;
  // an effect-only update would flash the non-matching layout.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQueryList(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => mediaQueryList(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot)
}
