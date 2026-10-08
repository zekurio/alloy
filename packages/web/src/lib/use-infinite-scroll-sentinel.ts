import { useEffect, useEffectEvent, useRef } from "react"

/**
 * Returns a ref to attach to a sentinel element near the end of a list. When
 * the sentinel scrolls into view (with a generous root margin so the next page
 * lands before the user hits the bottom) the supplied `fetchNextPage` runs,
 * unless a fetch is already in flight or there are no more pages.
 *
 * The intersection handler is an effect event, so it reads the latest values
 * while the observer is created once and never re-subscribes as query state
 * changes.
 */
export function useInfiniteScrollSentinel<Result>(
  fetchNextPage: () => Promise<Result>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const onIntersect = useEffectEvent((entries: IntersectionObserverEntry[]) => {
    if (!entries[0]?.isIntersecting) return
    if (isFetchingNextPage || !hasNextPage) return
    void fetchNextPage()
  })

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(
      (entries) => onIntersect(entries),
      { rootMargin: "800px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return sentinelRef
}
