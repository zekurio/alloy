import type { ClipFeedWindow } from "@alloy/api"
import { Link } from "@tanstack/react-router"

import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { TopClipsSection as TopClipsSectionBase } from "@/components/clip/top-clips-section"
import { useTopClipsQuery } from "@/lib/clip-queries"
import type { HomeSearch } from "@/lib/home-search"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type HomeTopClipsSectionProps = {
  viewerId: string | undefined
  window: ClipFeedWindow
}

const TOP_WINDOWS: ReadonlyArray<SortDropdownOption<ClipFeedWindow>> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
]

export function HomeTopClipsSection({
  viewerId,
  window,
}: HomeTopClipsSectionProps) {
  const { data: rows, error } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
  })

  return (
    <TopClipsSectionBase
      listKey={`home:top:${window}`}
      seed={`top-${window}`}
      rows={rows}
      error={error}
      owned={(row) => row.authorId === viewerId}
      emptyTitle={emptyTopTitle(window)}
      emptyHint="Check back in a bit or upload your own."
      actions={
        <SortDropdown
          value={window}
          options={TOP_WINDOWS}
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

function emptyTopTitle(window: ClipFeedWindow): string {
  switch (window) {
    case "today":
      return "No top clips today yet"
    case "week":
      return "No top clips this week yet"
    case "month":
      return "No top clips this month yet"
    case "year":
      return "No top clips this year yet"
    case "all":
      return "No top clips yet"
  }
}
