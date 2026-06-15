import type { ClipFeedWindow } from "@alloy/api"
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
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { FilterCarousel } from "@/components/filter-carousel"
import { useRequireAuth } from "@/lib/auth-hooks"
import { sanitizeTag } from "@/lib/clip-fields"
import { useTagClipsInfiniteQuery, useTagGamesQuery } from "@/lib/tag-queries"
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
  const session = useRequireAuth()
  const viewerId = session?.user.id
  const search = useSearch({ strict: false }) as TagSearch
  const tag = sanitizeTag(rawTag)
  const filters = tagFilters(search)

  return (
    <AppMain className="!px-2 !pt-0 md:!px-4">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 pt-4 md:pt-6">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
            <HashIcon className="size-5" />
          </span>
          <h1 className="text-foreground min-w-0 truncate text-2xl font-bold tracking-[-0.02em]">
            {tag}
          </h1>
        </div>

        <TagFilterBar tag={tag} search={search} />

        <TagClipsSection tag={tag} filters={filters} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}

function TagFilterBar({ tag, search }: { tag: string; search: TagSearch }) {
  const filters = tagFilters(search)
  const { data: games } = useTagGamesQuery(tag)
  const activeGameId = filters.igdbId

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
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
        <FilterCarousel>
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
              data-active={activeGameId === g.igdbId ? "true" : undefined}
              title={g.name}
              render={
                <Link
                  to="/tags/$tag"
                  params={{ tag }}
                  search={{ ...search, game: String(g.igdbId) }}
                />
              }
            >
              <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />
              {g.name}
            </Chip>
          ))}
        </FilterCarousel>
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
