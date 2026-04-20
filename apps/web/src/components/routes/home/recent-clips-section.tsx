import * as React from "react"
import { FilmIcon, Loader2Icon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { cn } from "@workspace/ui/lib/utils"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useRecentClipsInfiniteQuery } from "../../../lib/clip-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import { ClipCardSkeleton } from "./clip-card-skeleton"

type RecentClipsSectionProps = {
  viewerId: string
}

const RECENT_PAGE_LIMIT = 50

export function RecentClipsSection({ viewerId }: RecentClipsSectionProps) {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
  } = useRecentClipsInfiniteQuery({ limit: RECENT_PAGE_LIMIT })
  useQueryErrorToast(error, {
    title: "Couldn't load recent clips",
    toastId: "recent-clips-error",
  })

  const rows = React.useMemo(() => (data ? data.pages.flat() : []), [data])
  const visibleRows = rows

  const fetchNextRef = React.useRef(fetchNextPage)
  fetchNextRef.current = fetchNextPage
  const hasNextRef = React.useRef(hasNextPage)
  hasNextRef.current = hasNextPage
  const isFetchingNextRef = React.useRef(isFetchingNextPage)
  isFetchingNextRef.current = isFetchingNextPage

  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (isFetchingNextRef.current) return
        if (!hasNextRef.current) return
        void fetchNextRef.current()
      },
      { rootMargin: "800px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const initialLoad = isPending && rows.length === 0
  const hasRows = rows.length > 0

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            Recent clips
          </SectionTitle>
        </div>
        <SectionActions>
          {hasRows ? (
            <span className="font-mono text-2xs text-foreground-faint">
              {rows.length} loaded
              {hasNextPage ? " · more below" : ""}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {initialLoad ? (
        <ClipGrid>
          {Array.from({ length: 10 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : !hasRows && error ? (
        <EmptyState
          seed="recent-error"
          size="lg"
          title="Couldn't load recent clips"
        />
      ) : !hasRows ? (
        <EmptyState
          seed="recent-empty"
          size="lg"
          title="No recent clips"
          hint="Upload your first clip to seed the feed."
        />
      ) : (
        <ClipGrid>
          {visibleRows.map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                variants={card.variants}
                authorHandle={card.author}
                authorId={card.authorId}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                gameRef={card.gameRef}
                gameHref={card.gameRef ? `/g/${card.gameRef.slug}` : null}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
                privacy={card.authorId === viewerId ? card.privacy : undefined}
                clipPrivacy={card.privacy}
                description={card.description}
              />
            )
          })}
        </ClipGrid>
      )}

      <div
        ref={sentinelRef}
        aria-hidden
        className="mt-6 flex min-h-6 items-center justify-center"
      >
        {isFetchingNextPage && hasRows ? (
          <span
            className={cn(
              "inline-flex items-center gap-2 font-mono text-2xs",
              "tracking-[0.08em] text-foreground-faint uppercase"
            )}
          >
            <Loader2Icon className="size-3 animate-spin" />
            Loading more
          </span>
        ) : error && hasRows ? (
          <button
            type="button"
            onClick={() => void refetch()}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-2xs tracking-[0.08em] text-accent uppercase",
              "hover:bg-accent-soft",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          >
            Retry
          </button>
        ) : !hasNextPage && hasRows ? (
          <span className="font-mono text-2xs tracking-[0.08em] text-foreground-faint uppercase">
            End of feed
          </span>
        ) : null}
      </div>
    </section>
  )
}
