import type { GameListRow } from "@alloy/api"
import { t as tx, tp } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { GlobeIcon, HashIcon } from "lucide-react"
import * as React from "react"

import { ClipCardList } from "@/components/clip/clip-card-list"
import {
  FilterDropdown,
  type FilterDropdownOption,
} from "@/components/clip/filter-dropdown"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { useHeaderToolbar } from "@/components/layout/header-toolbar"
import { sanitizeTag } from "@/lib/clip-fields"
import { formatCount } from "@/lib/number-format"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useTagClipsInfiniteQuery, useTagSummaryQuery } from "@/lib/tag-queries"
import { type TagSearch, tagFilters } from "@/lib/tag-search"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

const SORTS: ReadonlyArray<SortDropdownOption<"top" | "recent">> = [
  { key: "top", label: tx("Top") },
  { key: "recent", label: tx("Recent") },
]

export function TagsPageInner({ tag: rawTag }: { tag: string }) {
  const session = useSuspenseSession()
  const viewerId = session?.user.id
  const search = useSearch({ strict: false }) as TagSearch
  const tag = sanitizeTag(rawTag)
  const filters = tagFilters(search)
  const { data: summary } = useTagSummaryQuery(tag)
  const toolbarSearchKey = JSON.stringify(search)
  const toolbarSearch = React.useMemo(() => search, [toolbarSearchKey])
  const toolbar = React.useMemo(
    () => (
      <TagFilterBar tag={tag} search={toolbarSearch} games={summary?.games} />
    ),
    [summary?.games, tag, toolbarSearch],
  )
  useHeaderToolbar(toolbar)

  return (
    <AppMain className="!px-2 md:!px-8">
      <div className="flex w-full flex-col gap-5 py-3 md:gap-6 md:py-6">
        <TagHeader tag={tag} clipCount={summary?.clipCount} />

        <TagClipsSection tag={tag} filters={filters} viewerId={viewerId} />
      </div>
    </AppMain>
  )
}

function clipCountLabel(count: number) {
  return tx("{count} {label}", {
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
  const navigate = useNavigate()
  const filters = tagFilters(search)
  const activeGameId = filters.steamgriddbId
  const ALL_GAMES = "__all"

  const gameOptions: FilterDropdownOption<string>[] = [
    { key: ALL_GAMES, label: tx("All games"), icon: <GlobeIcon /> },
    ...(games ?? []).map((g) => ({
      key: String(g.steamgriddbId),
      label: g.name,
      icon: <GameIcon src={g.iconUrl ?? g.logoUrl} name={g.name} />,
      count: g.clipCount,
    })),
  ]

  return (
    <div className="flex items-center gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SortDropdown
          label={tx("Sort")}
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

      {games && games.length > 0 ? (
        <FilterDropdown
          label={tx("Game")}
          value={activeGameId === undefined ? ALL_GAMES : String(activeGameId)}
          options={gameOptions}
          searchPlaceholder={tx("Search games…")}
          onSelect={(key) => {
            void navigate({
              to: "/tags/$tag",
              params: { tag },
              search: {
                ...search,
                game: key === ALL_GAMES ? undefined : key,
              },
            })
          }}
        />
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
    title: tx("Couldn't load clips"),
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
        title={tx("No clips tagged #{tag}", { tag })}
        hint={tx("Try a different game.")}
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
