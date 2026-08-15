import type { GameListRow } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link, useSearch } from "@tanstack/react-router"
import { AlertCircleIcon, GlobeIcon, HashIcon, TagIcon } from "lucide-react"
import { useMemo } from "react"

import { ClipCardList } from "@/components/clip/clip-card-list"
import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { sanitizeTag } from "@/lib/clip-fields"
import { formatCount } from "@/lib/number-format"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useTagClipsInfiniteQuery, useTagSummaryQuery } from "@/lib/tag-queries"
import { type TagSearch, tagFilters } from "@/lib/tag-search"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"

const SORTS: ReadonlyArray<SortDropdownOption<"top" | "recent">> = [
  { key: "top", label: t("Top") },
  { key: "recent", label: t("Recent") },
]

export function TagsPageInner({ tag: rawTag }: { tag: string }) {
  const session = useSuspenseSession()
  const viewerId = session?.user.id
  // SAFETY: This route's validateSearch function returns TagSearch.
  const search = useSearch({ strict: false }) as TagSearch
  const tag = sanitizeTag(rawTag)
  const filters = tagFilters(search)
  const { data: summary } = useTagSummaryQuery(tag)

  return (
    <AppMain>
      <div className="flex w-full flex-col">
        <TagHeader tag={tag} clipCount={summary?.clipCount} />
        <PageToolbar rail={false}>
          <TagFilterBar tag={tag} search={search} games={summary?.games} />
        </PageToolbar>

        <TagClipsSection tag={tag} filters={filters} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}

function clipCountLabel(count: number) {
  return t("{count} {label}", {
    count: formatCount(count),
    label: tp(count, "clip", "clips"),
  })
}

function TagHeader({
  tag,
  clipCount,
}: {
  tag: string
  clipCount: number | undefined
}) {
  return (
    <header className="mb-1 flex min-w-0 items-center gap-3 py-2 sm:gap-4 sm:py-3">
      <span className="border-border bg-surface-raised text-foreground-muted grid size-10 shrink-0 place-items-center rounded-lg border sm:size-12">
        <HashIcon className="size-5 sm:size-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-foreground text-xl leading-tight font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-2xl">
          {tag}
        </h1>
        {clipCount === undefined ? (
          <span
            aria-hidden
            className="bg-surface-raised mt-1 block h-4 w-16 animate-pulse rounded"
          />
        ) : (
          <p className="text-foreground-muted mt-0.5 text-sm font-medium tabular-nums">
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
  const activeGameId = filters.gameId
  const ALL_GAMES = "__all"

  const gameOptions: FilterChipOption<string>[] = [
    { key: ALL_GAMES, label: t("All games"), icon: <GlobeIcon /> },
    ...(games ?? []).map((g) => ({
      key: g.id,
      label: g.name,
      icon: <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />,
    })),
  ]

  return (
    <>
      {games && games.length > 0 ? (
        <FilterChipRail
          activeKey={activeGameId ?? ALL_GAMES}
          options={gameOptions}
          renderOptionLink={(opt, active) => (
            <Link
              to="/tags/$tag"
              params={{ tag }}
              search={{
                ...search,
                game: opt.key === ALL_GAMES ? undefined : opt.key,
              }}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      ) : null}

      <div className="shrink-0">
        <SortDropdown
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
      </div>
    </>
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
  const rows = useMemo(
    () => (data ? data.pages.flatMap((page) => page.items) : []),
    [data],
  )
  const paginationError = Boolean(error) && rows.length > 0

  const sentinelRef = useInfiniteScrollSentinel(
    fetchNextPage,
    Boolean(hasNextPage) && !paginationError,
    isFetchingNextPage,
  )

  if (isPending && rows.length === 0) {
    return <LoadingState />
  }

  if (error && rows.length === 0) {
    return (
      <EmptyState
        icon={AlertCircleIcon}
        size="lg"
        title={t("Couldn't load clips")}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={TagIcon}
        size="lg"
        title={t("No clips tagged #{tag}", { tag })}
        hint={t("Try a different game.")}
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
      {hasNextPage || isFetchingNextPage || paginationError ? (
        <div
          ref={sentinelRef}
          className="mt-6 flex min-h-6 items-center justify-center"
        >
          {isFetchingNextPage ? (
            <Spinner className="size-3" />
          ) : paginationError ? (
            <div
              role="alert"
              className="text-foreground-muted flex items-center gap-2 text-xs"
            >
              <AlertCircleIcon className="text-destructive size-4" />
              <span>{t("Couldn't load more clips")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void fetchNextPage()}
              >
                {t("Retry")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
