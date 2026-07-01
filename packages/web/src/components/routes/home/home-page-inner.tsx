import type { ClipFeedSort } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Link, useSearch } from "@tanstack/react-router"
import { useMemo } from "react"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { useHeaderToolbar } from "@/components/layout/header-toolbar"
import { createHeaderToolbarControls } from "@/components/layout/header-toolbar-controls"
import { CLIP_SORT_OPTIONS, DEFAULT_CLIP_SORT } from "@/lib/clip-sort"
import { homeFeedFilter, type HomeSearch } from "@/lib/home-search"
import { useSuspenseSession } from "@/lib/session-suspense"

import { FeedFilterDropdown } from "./feed-filter-dropdown"
import { FeedSection } from "./feed-section"

export function HomePageInner() {
  const session = useSuspenseSession()
  const search = useSearch({ strict: false }) as HomeSearch
  const toolbarSearchKey = JSON.stringify(search)
  const toolbarSearch = useMemo(() => search, [toolbarSearchKey])

  const filter = useMemo(() => homeFeedFilter(toolbarSearch), [toolbarSearch])
  const sort: ClipFeedSort = toolbarSearch.sort ?? DEFAULT_CLIP_SORT

  const viewerId = session?.user.id
  const toolbar = useMemo(() => {
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
    const mobileSortControl = (
      <SortDropdown
        value={sort}
        triggerLabel={t("Sort")}
        triggerVariant="icon"
        options={CLIP_SORT_OPTIONS}
        contentClassName="w-40"
        renderOptionLink={(opt, active) => (
          <Link
            to="/"
            search={{
              ...toolbarSearch,
              sort: opt.key === DEFAULT_CLIP_SORT ? undefined : opt.key,
            }}
            data-active={active ? "true" : undefined}
          />
        )}
      />
    )
    return createHeaderToolbarControls({
      desktop: (
        <>
          <FeedFilterDropdown filter={filter} search={toolbarSearch} />
          {sortControl}
        </>
      ),
      mobile: (
        <>
          <FeedFilterDropdown
            filter={filter}
            search={toolbarSearch}
            triggerVariant="icon"
          />
          {mobileSortControl}
        </>
      ),
    })
  }, [filter, sort, toolbarSearch])
  useHeaderToolbar(toolbar)

  return (
    <AppMain>
      <section className="flex w-full flex-col gap-6">
        <FeedSection filter={filter} sort={sort} viewerId={viewerId} />
      </section>
    </AppMain>
  )
}
