import * as React from "react"

import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { ClipCardList } from "@/components/clip/clip-card-list"
import { ClipGridSkeleton } from "@/components/clip/clip-grid"
import { EmptyState } from "@/components/feedback/empty-state"
import type { FeedFilter } from "@workspace/api"
import { useFeedInfiniteQuery } from "@/lib/feed-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type FeedSectionProps = {
  filter: FeedFilter
  viewerId: string | undefined
}

const FEED_PAGE_LIMIT = 20

function useInfiniteScrollSentinel(
  fetchNextPage: () => Promise<unknown>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean
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
      { rootMargin: "800px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return sentinelRef
}

function emptyTitle(filter: FeedFilter): string {
  switch (filter.kind) {
    case "foryou":
      return "Nothing to show yet"
    case "following":
      return "Your following feed is empty"
    case "game":
      return "No clips in this game yet"
  }
}

function emptyHint(filter: FeedFilter): string {
  switch (filter.kind) {
    case "foryou":
      return "Come back when others have uploaded some clips."
    case "following":
      return "Follow creators or favourite games to populate this tab."
    case "game":
      return "Be the first to post one."
  }
}

function filterId(filter: FeedFilter): string {
  if (filter.kind === "game") return `game:${filter.gameId}`
  return filter.kind
}

function FeedSentinelStatus({
  isRefreshing,
  isFetchingNextPage,
  hasRows,
  error,
  hasNextPage,
  onRetry,
}: {
  isRefreshing: boolean
  isFetchingNextPage: boolean
  hasRows: boolean
  error: unknown
  hasNextPage: boolean
  onRetry: () => void
}) {
  if (isFetchingNextPage && hasRows) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xs",
          "tracking-wide text-foreground-faint uppercase"
        )}
      >
        <Spinner className="size-3" />
      </span>
    )
  }
  if (isRefreshing && hasRows) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xs",
          "tracking-wide text-foreground-faint uppercase"
        )}
      >
        <Spinner className="size-3" />
      </span>
    )
  }
  if (error && hasRows) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium tracking-wide text-accent uppercase",
          "hover:bg-accent-soft",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        Retry
      </button>
    )
  }
  if (!hasNextPage && hasRows) {
    return (
      <span className="text-xs tracking-wide text-foreground-faint uppercase">
        End of feed
      </span>
    )
  }
  return null
}

export function FeedSection({ filter, viewerId }: FeedSectionProps) {
  const feedId = filterId(filter)
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isPlaceholderData,
    isPending,
    refetch,
  } = useFeedInfiniteQuery(filter, { limit: FEED_PAGE_LIMIT })
  useQueryErrorToast(error, {
    title: "Couldn't load feed",
    // Keying the toast on filter avoids stacked toasts when tabs switch.
    toastId: `feed-${feedId}-error`,
  })

  const rows = React.useMemo(
    () => (data ? data.pages.flatMap((page) => page.items) : []),
    [data]
  )
  const hasData = data !== undefined

  const sentinelRef = useInfiniteScrollSentinel(
    fetchNextPage,
    Boolean(hasNextPage),
    isFetchingNextPage
  )

  const initialLoad = isPending && rows.length === 0
  const hasRows = rows.length > 0
  const isRefreshing =
    hasRows && (isFetching || isPlaceholderData) && !isFetchingNextPage

  return (
    <section aria-busy={isRefreshing ? true : undefined}>
      <div
        className={cn(
          "transition-opacity duration-150",
          isRefreshing && "opacity-70"
        )}
      >
        {initialLoad ? (
          <ClipGridSkeleton count={10} />
        ) : !hasData && error ? (
          <EmptyState
            seed={`feed-${feedId}-error`}
            size="lg"
            title="Couldn't load feed"
          />
        ) : !hasRows ? (
          <EmptyState
            seed={`feed-${feedId}-empty`}
            size="lg"
            title={emptyTitle(filter)}
            hint={emptyHint(filter)}
          />
        ) : (
          <ClipCardList
            rows={rows}
            isOwnedByViewer={(row) => row.authorId === viewerId}
            listKey={`home:feed:${feedId}`}
          />
        )}
      </div>

      <div
        ref={sentinelRef}
        aria-hidden
        className="mt-6 flex min-h-6 items-center justify-center"
      >
        <FeedSentinelStatus
          isRefreshing={isRefreshing}
          isFetchingNextPage={isFetchingNextPage}
          hasRows={hasRows}
          error={error}
          hasNextPage={Boolean(hasNextPage)}
          onRetry={() => void refetch()}
        />
      </div>
    </section>
  )
}
