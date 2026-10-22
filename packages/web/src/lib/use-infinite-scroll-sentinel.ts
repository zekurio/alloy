import { useEffect, useEffectEvent, useState } from "react"

/**
 * Returns a callback ref to attach to a sentinel element near the end of a
 * list. When the sentinel scrolls into view (with a generous root margin so
 * the next page lands before the user hits the bottom) the supplied
 * `fetchNextPage` runs, unless a fetch is already in flight or there are no
 * more pages.
 *
 * The element is held in state, so a sentinel that mounts after the first
 * render (lists often render it only once a page has loaded) is still
 * observed. The intersection handler is an effect event, so it reads the
 * latest values without re-subscribing as query state changes.
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

  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!element || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(
      (entries) => onIntersect(entries),
      { rootMargin: "800px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return setElement
}
