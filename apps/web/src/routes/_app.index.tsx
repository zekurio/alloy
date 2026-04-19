import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { FlameIcon, Loader2Icon } from "lucide-react"

import { AppMain } from "@workspace/ui/components/app-shell"
import { Chip } from "@workspace/ui/components/chip"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { ClipCardTrigger } from "../components/clip-player-dialog"
import { ClipGrid } from "../components/clip-grid"
import { EmptyState } from "../components/empty-state"
import { HomeHeader } from "../components/home-header"
import { UploadFlow } from "../components/upload-flow"
import { useRequireAuth } from "../lib/auth-hooks"
import { toClipCardData } from "../lib/clip-format"
import {
  fetchClips,
  type ClipFeedWindow,
  type ClipRow,
} from "../lib/clips-api"

/**
 * Home feed.
 *
 * Two shelves:
 *   - **Top clips** — tabbed by window (today / week / month), top 5 by
 *     like count. Small data set, one fetch per tab click. The chips keep
 *     the previous tab's cards visible until the new window resolves so
 *     the row doesn't blank on every click.
 *   - **Recent clips** — infinite scroll, 50 rows per batch, cursor-based.
 *     We watch a sentinel below the grid with `IntersectionObserver`; when
 *     it enters the viewport we page forward until the server stops
 *     returning full batches.
 *
 * The galleries sit inside a centered `max-w` container (`6xl`) with
 * mirrored horizontal padding so the content doesn't stretch across
 * wider viewports and the left/right gutters match.
 */
export const Route = createFileRoute("/_app/")({
  component: HomePage,
})

const RECENT_PAGE_LIMIT = 50

function HomePage() {
  return (
    <React.Suspense fallback={null}>
      <HomePageInner />
    </React.Suspense>
  )
}

function HomePageInner() {
  const session = useRequireAuth()
  if (!session) return null

  return (
    <>
      <HomeHeader />
      <AppMain>
        {/* Centered column — keeps the 5-col grid aligned and mirrors the
            padding left/right on wide monitors. */}
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10">
          <TopClipsSection />
          <RecentClipsSection />
        </div>
      </AppMain>
      <UploadFlow />
    </>
  )
}

// ─── Top clips ─────────────────────────────────────────────────────────

const TOP_WINDOWS: ReadonlyArray<{ key: ClipFeedWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

function TopClipsSection() {
  const [window, setWindow] = React.useState<ClipFeedWindow>("today")
  const [rows, setRows] = React.useState<ClipRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Refetch on window change. `cancelled` guards against a stale response
  // arriving after the user has already flipped to a different tab.
  React.useEffect(() => {
    let cancelled = false
    setError(null)
    setRows(null)
    fetchClips({ window, sort: "top", limit: 5 })
      .then((next) => {
        if (!cancelled) setRows(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof Error ? cause.message : "Couldn't load top clips"
        )
      })
    return () => {
      cancelled = true
    }
  }, [window])

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FlameIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
        <SectionActions>
          {TOP_WINDOWS.map((w) => (
            <Chip
              key={w.key}
              data-active={window === w.key ? "true" : undefined}
              onClick={() => setWindow(w.key)}
            >
              {w.label}
            </Chip>
          ))}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`top-${window}-error`}
          size="md"
          title="Couldn't load top clips"
          hint={error}
        />
      ) : rows === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : rows.length === 0 ? (
        <EmptyState
          // Seed per-window so cycling tabs doesn't rotate the face mid-flip.
          seed={`top-${window}-empty`}
          size="md"
          title={emptyTopTitle(window)}
          hint="Check back in a bit or upload your own."
        />
      ) : (
        <ClipGrid>
          {rows.map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                authorHandle={card.author}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
              />
            )
          })}
        </ClipGrid>
      )}
    </section>
  )
}

function emptyTopTitle(window: ClipFeedWindow): string {
  switch (window) {
    case "today":
      return "No top clips today yet"
    case "week":
      return "No top clips this week yet"
    case "month":
      return "No top clips this month yet"
  }
}

// ─── Recent clips (infinite scroll) ────────────────────────────────────

type RecentState =
  | { status: "idle"; rows: ClipRow[]; hasMore: boolean; nextCursor: string | null }
  | { status: "loading"; rows: ClipRow[]; hasMore: boolean; nextCursor: string | null }
  | { status: "error"; rows: ClipRow[]; hasMore: boolean; nextCursor: string | null; message: string }

function RecentClipsSection() {
  // Keep state in a single shape so the sentinel effect can read one
  // atom and make a loading decision without chasing multiple flags
  // that could disagree mid-update.
  const [state, setState] = React.useState<RecentState>({
    status: "loading",
    rows: [],
    hasMore: true,
    nextCursor: null,
  })

  // `latestStateRef` lets the observer callback peek at current status
  // without re-subscribing on every state change — the effect below
  // only depends on stable refs, so the observer is created once.
  const latestStateRef = React.useRef(state)
  latestStateRef.current = state

  const loadMore = React.useCallback(async () => {
    const current = latestStateRef.current
    if (current.status === "loading") return
    if (!current.hasMore) return

    setState({
      status: "loading",
      rows: current.rows,
      hasMore: current.hasMore,
      nextCursor: current.nextCursor,
    })

    try {
      const next = await fetchClips({
        sort: "recent",
        limit: RECENT_PAGE_LIMIT,
        cursor: current.nextCursor ?? undefined,
      })
      // "Got a full batch" is our proxy for "probably more to fetch".
      // A short batch means we hit the end of the table for this user.
      const hasMore = next.length >= RECENT_PAGE_LIMIT
      const last = next.length > 0 ? next[next.length - 1] : null
      setState({
        status: "idle",
        rows: [...current.rows, ...next],
        hasMore,
        nextCursor: last ? last.createdAt : current.nextCursor,
      })
    } catch (cause) {
      setState({
        status: "error",
        rows: current.rows,
        hasMore: current.hasMore,
        nextCursor: current.nextCursor,
        message:
          cause instanceof Error ? cause.message : "Couldn't load more clips",
      })
    }
  }, [])

  // Kick off the initial load on mount.
  React.useEffect(() => {
    void loadMore()
  }, [loadMore])

  // IntersectionObserver on a sentinel below the grid — preferred over
  // a scroll listener because the browser does the math for us and we
  // don't pay a handler on every pixel of scroll. `rootMargin` kicks
  // the fetch off a viewport height early so the next page is already
  // in by the time the user would otherwise hit the end.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        const s = latestStateRef.current
        if (s.status === "loading") return
        if (!s.hasMore) return
        if (s.status === "error") return
        void loadMore()
      },
      { rootMargin: "800px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const initialLoad = state.status === "loading" && state.rows.length === 0
  const hasRows = state.rows.length > 0

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>Recent clips</SectionTitle>
        </div>
        <SectionActions>
          {hasRows ? (
            <span className="font-mono text-2xs text-foreground-faint">
              {state.rows.length} loaded
              {state.hasMore ? " · more below" : ""}
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
      ) : !hasRows && state.status === "error" ? (
        <EmptyState
          seed="recent-error"
          size="lg"
          title="Couldn't load recent clips"
          hint={state.message}
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
          {state.rows.map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                authorHandle={card.author}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
              />
            )
          })}
        </ClipGrid>
      )}

      {/* Sentinel + status line. The sentinel itself is invisible; the
          line above surfaces a spinner while a page is fetching and a
          quiet "end of feed" once we've exhausted the table. */}
      <div
        ref={sentinelRef}
        aria-hidden
        className="mt-6 flex min-h-6 items-center justify-center"
      >
        {state.status === "loading" && hasRows ? (
          <span
            className={cn(
              "inline-flex items-center gap-2 font-mono text-2xs",
              "tracking-[0.08em] text-foreground-faint uppercase"
            )}
          >
            <Loader2Icon className="size-3 animate-spin" />
            Loading more
          </span>
        ) : state.status === "error" && hasRows ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-2xs tracking-[0.08em] text-accent uppercase",
              "hover:bg-accent-soft",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          >
            Retry
          </button>
        ) : !state.hasMore && hasRows ? (
          <span className="font-mono text-2xs tracking-[0.08em] text-foreground-faint uppercase">
            End of feed
          </span>
        ) : null}
      </div>
    </section>
  )
}

function ClipCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-video rounded-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}
