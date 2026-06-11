import * as React from "react"

/**
 * Returns a ref to attach to a sentinel element near the end of a list. When
 * the sentinel scrolls into view (with a generous root margin so the next page
 * lands before the user hits the bottom) the supplied `fetchNextPage` runs,
 * unless a fetch is already in flight or there are no more pages.
 *
 * Latest values are tracked through refs so the observer is created once and
 * never re-subscribes as query state changes.
 */
export function useInfiniteScrollSentinel(
  fetchNextPage: () => Promise<unknown>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const fetchNextRef = React.useRef(fetchNextPage)
  fetchNextRef.current = fetchNextPage
  const hasNextRef = React.useRef(hasNextPage)
  hasNextRef.current = hasNextPage
  const isFetchingNextRef = React.useRef(isFetchingNextPage)
  isFetchingNextRef.current = isFetchingNextPage

  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (isFetchingNextRef.current || !hasNextRef.current) return
        void fetchNextRef.current()
      },
      { rootMargin: "800px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return sentinelRef
}
