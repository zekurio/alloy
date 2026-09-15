import type { ClipFeedSort } from "@alloy/api"
import { AppMainColumn, AppMainScroll } from "@alloy/ui/components/app-shell"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Link, useSearch } from "@tanstack/react-router"
import { useMemo } from "react"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { CLIP_SORT_OPTIONS, DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import { homeFeedFilter, type HomeSearch } from "@/lib/home-search"
import { useSuspenseSession } from "@/lib/session-suspense"

import { FeedChipBar } from "./feed-chip-bar"
import { FeedSection, useIsFeedEmpty } from "./feed-section"

export function HomePageInner({
  screenshots = false,
}: {
  screenshots?: boolean
}) {
  const to = screenshots ? "/screenshots" : "/"
  const session = useSuspenseSession()
  // SAFETY: The home route's validateSearch function returns HomeSearch.
  const search = useSearch({ strict: false }) as HomeSearch
  const toolbarSearchKey = JSON.stringify(search)
  const toolbarSearch = useMemo(() => search, [toolbarSearchKey])

  const filter = useMemo(
    () => ({
      ...homeFeedFilter(toolbarSearch),
      media: screenshots ? ("image" as const) : ("video" as const),
    }),
    [toolbarSearch, screenshots],
  )
  const sort: ClipFeedSort = toolbarSearch.sort ?? DEFAULT_CLIP_SORT

  const viewerId = session?.user.id
  // Nothing to narrow or reorder: keep the toolbar only while a game filter
  // is active, so it can still be cleared.
  const feedEmpty = useIsFeedEmpty(filter, sort)
  const showToolbar = !feedEmpty || filter.kind !== "all"
  const sortControl = (
    <SortDropdown
      value={sort}
      options={CLIP_SORT_OPTIONS}
      contentClassName="w-40"
      renderOptionLink={(opt, active) => (
        <Link
          to={to}
          search={{
            ...toolbarSearch,
            // The default sort stays out of the URL.
            sort: opt.key === DEFAULT_CLIP_SORT ? undefined : opt.key,
          }}
          data-active={active ? "true" : undefined}
        />
      )}
    />
  )

  return (
    <AppMainColumn>
      {showToolbar ? (
        <PageToolbar pinned rail={false}>
          <FeedChipBar filter={filter} search={toolbarSearch} to={to} />
          <div className="shrink-0">{sortControl}</div>
        </PageToolbar>
      ) : null}
      <AppMainScroll className={showToolbar ? "!pt-0" : undefined}>
        <section className="flex w-full flex-col gap-6">
          <FeedSection filter={filter} sort={sort} viewerId={viewerId} />
        </section>
      </AppMainScroll>
    </AppMainColumn>
  )
}
