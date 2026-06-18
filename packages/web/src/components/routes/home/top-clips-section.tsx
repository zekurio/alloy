import type { ClipFeedWindow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { Link } from "@tanstack/react-router"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { TopClipsSection as TopClipsSectionBase } from "@/components/clip/top-clips-section"
import {
  TOP_CLIPS_WINDOW_OPTIONS,
  topClipsEmptyTitle,
} from "@/lib/clip-feed-windows"
import { useTopClipsQuery } from "@/lib/clip-queries"
import type { HomeSearch } from "@/lib/home-search"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type HomeTopClipsSectionProps = {
  viewerId: string | undefined
  window: ClipFeedWindow
}

export function HomeTopClipsSection({
  viewerId,
  window,
}: HomeTopClipsSectionProps) {
  const { data: rows, error } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: tx("Couldn't load top clips"),
    toastId: `top-clips-${window}-error`,
  })

  return (
    <TopClipsSectionBase
      listKey={`home:top:${window}`}
      seed={`top-${window}`}
      rows={rows}
      error={error}
      owned={(row) => row.authorId === viewerId}
      emptyTitle={topClipsEmptyTitle(window)}
      emptyHint={tx("Check back in a bit or upload your own.")}
      actions={
        <SortDropdown
          value={window}
          options={TOP_CLIPS_WINDOW_OPTIONS}
          contentClassName="w-40"
          renderOptionLink={(opt, active) => (
            <Link
              to="/"
              search={(prev: HomeSearch) => ({
                ...prev,
                // "today" is the default — keep it out of the URL.
                window: opt.key === "today" ? undefined : opt.key,
              })}
              data-active={active ? "true" : undefined}
            />
          )}
        />
      }
    />
  )
}
