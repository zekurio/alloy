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
import { FeedSection } from "./feed-section"

export function HomePageInner() {
  const session = useSuspenseSession()
  const search = useSearch({ strict: false }) as HomeSearch
  const toolbarSearchKey = JSON.stringify(search)
  const toolbarSearch = useMemo(() => search, [toolbarSearchKey])

  const filter = useMemo(() => homeFeedFilter(toolbarSearch), [toolbarSearch])
  const sort: ClipFeedSort = toolbarSearch.sort ?? DEFAULT_CLIP_SORT

  const viewerId = session?.user.id
  const sortControl = (
    <SortDropdown
      value={sort}
      options={CLIP_SORT_OPTIONS}
      contentClassName="w-40"
      renderOptionLink={(opt, active) => (
        <Link
          to="/"
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
      <PageToolbar pinned rail={false}>
        <FeedChipBar filter={filter} search={toolbarSearch} />
        <div className="shrink-0">{sortControl}</div>
      </PageToolbar>
      <AppMainScroll>
        <section className="flex w-full flex-col gap-6">
          <FeedSection filter={filter} sort={sort} viewerId={viewerId} />
        </section>
      </AppMainScroll>
    </AppMainColumn>
  )
}
