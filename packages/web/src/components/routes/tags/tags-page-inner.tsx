import type { ClipFeedWindow, GameListRow } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Chip } from "@alloy/ui/components/chip"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link, useSearch } from "@tanstack/react-router"
import { HashIcon } from "lucide-react"
import * as React from "react"

import { ClipCardList } from "@/components/clip/clip-card-list"
import {
  filterLabelClass,
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { FilterCarousel } from "@/components/filter-carousel"
import { sanitizeTag } from "@/lib/clip-fields"
import { formatCount } from "@/lib/number-format"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useTagClipsInfiniteQuery, useTagSummaryQuery } from "@/lib/tag-queries"
import { type TagSearch, tagFilters } from "@/lib/tag-search"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

const SORTS: ReadonlyArray<SortDropdownOption<"top" | "recent">> = [
  { key: "top", label: "Top" },
  { key: "recent", label: "Recent" },
]

const WINDOWS: ReadonlyArray<SortDropdownOption<ClipFeedWindow>> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
]

export function TagsPageInner({ tag: rawTag }: { tag: string }) {
  const session = useSuspenseSession()
  const viewerId = session?.user.id
  const search = useSearch({ strict: false }) as TagSearch
  const tag = sanitizeTag(rawTag)
  const filters = tagFilters(search)
  const { data: summary } = useTagSummaryQuery(tag)

  return (
    <AppMain className="!px-2 md:!px-8">
      <div className="flex w-full flex-col gap-5 py-3 md:gap-6 md:py-6">
        <TagHeader tag={tag} clipCount={summary?.clipCount} />

        <TagFilterBar tag={tag} search={search} games={summary?.games} />

        <TagClipsSection tag={tag} filters={filters} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}

function clipCountLabel(count: number) {
  return `${formatCount(count)} ${count === 1 ? "clip" : "clips"}`
}

function TagHeader({
  tag,
  clipCount,
}: {
  tag: string
  clipCount: number | undefined
}) {
  return (
    <header className="flex min-w-0 items-start gap-3">
      <span className="border-border bg-surface-raised text-foreground-muted flex size-10 shrink-0 items-center justify-center rounded-lg border">
        <HashIcon className="size-5" />
      </span>
      <div className="min-w-0">
        <h1 className="text-foreground min-w-0 truncate text-2xl font-bold tracking-tight md:text-3xl">
          {tag}
        </h1>
        {clipCount === undefined ? null : (
          <p className="text-foreground-muted mt-0.5 text-sm font-semibold tabular-nums">
            {clipCountLabel(clipCount)}
          </p>
        )}
      </div>
    </header>
  )
}

function TagFilterBar({
  tag,
  search,
  games,
}: {
  tag: string
  search: TagSearch
  games: GameListRow[] | undefined
}) {
  const filters = tagFilters(search)
  const activeGameId = filters.steamgriddbId

  return (
    <div className="border-border flex flex-col gap-3 border-y py-3 lg:flex-row lg:items-center lg:gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SortDropdown
          label="Sort"
          value={filters.sort}
          options={SORTS}
          contentClassName="w-40"
          renderOptionLink={(opt, active) => (
            <Link
              to="/tags/$tag"
              params={{ tag }}
              search={{
                ...search,
                sort: opt.key === "top" ? undefined : opt.key,
              }}
              data-active={active ? "true" : undefined}
            />
          )}
        />
        <SortDropdown
          label="When"
          value={filters.window}
          options={WINDOWS}
          contentClassName="w-40"
          renderOptionLink={(opt, active) => (
            <Link
              to="/tags/$tag"
              params={{ tag }}
              search={{
                ...search,
                window: opt.key === "all" ? undefined : opt.key,
              }}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      </div>

      {games && games.length > 0 ? (
        <>
          <span
            aria-hidden
            className="bg-border hidden h-5 w-px shrink-0 lg:block"
          />
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={filterLabelClass}>Game</span>
            <FilterCarousel className="min-w-0 flex-1">
              <Chip
                size="xl"
                data-active={activeGameId === undefined ? "true" : undefined}
                render={
                  <Link
                    to="/tags/$tag"
                    params={{ tag }}
                    search={{ ...search, game: undefined }}
                  />
                }
              >
                All games
              </Chip>
              {games.map((g) => (
                <Chip
                  key={g.id}
                  size="xl"
                  data-active={
                    activeGameId === g.steamgriddbId ? "true" : undefined
                  }
                  title={g.name}
                  render={
                    <Link
                      to="/tags/$tag"
                      params={{ tag }}
                      search={{ ...search, game: String(g.steamgriddbId) }}
                    />
                  }
                >
                  <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
                  <span className="max-w-[10rem] truncate">{g.name}</span>
                  <span className="text-foreground-faint tabular-nums">
                    {g.clipCount}
                  </span>
                </Chip>
              ))}
            </FilterCarousel>
          </div>
        </>
      ) : null}
    </div>
  )
}

function TagClipsSection({
  tag,
  filters,
  viewerId,
}: {
  tag: string
  filters: ReturnType<typeof tagFilters>
  viewerId: string | undefined
}) {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
  } = useTagClipsInfiniteQuery(tag, filters)
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: `tag-${tag}-error`,
  })

  const rows = React.useMemo(
    () => (data ? data.pages.flatMap((page) => page.items) : []),
    [data],
  )

  const sentinelRef = useInfiniteScrollSentinel(
    fetchNextPage,
    Boolean(hasNextPage),
    isFetchingNextPage,
  )

  if (isPending && rows.length === 0) {
    return <LoadingState />
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        seed={`tag-${tag}-empty`}
        size="lg"
        title={`No clips tagged #${tag}`}
        hint="Try a different game or time window."
      />
    )
  }

  return (
    <section>
      <ClipCardList
        rows={rows}
        isOwnedByViewer={(row) => row.authorId === viewerId}
        listKey={`tag:${tag}`}
      />
      {hasNextPage || isFetchingNextPage ? (
        <div
          ref={sentinelRef}
          aria-hidden
          className="mt-6 flex min-h-6 items-center justify-center"
        >
          {isFetchingNextPage ? <Spinner className="size-3" /> : null}
        </div>
      ) : null}
    </section>
  )
}
