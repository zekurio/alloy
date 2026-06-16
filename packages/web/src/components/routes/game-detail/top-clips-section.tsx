import type { ClipFeedWindow } from "@alloy/api"
import { Link } from "@tanstack/react-router"

import { SortDropdown } from "@/components/clip/sort-dropdown"
import { TopClipsSection as TopClipsSectionBase } from "@/components/clip/top-clips-section"
import {
  TOP_CLIPS_WINDOW_OPTIONS,
  topClipsEmptyTitle,
} from "@/lib/clip-feed-windows"
import { useGameTopClipsQuery } from "@/lib/game-queries"
import type { GameSearch } from "@/lib/game-search"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type GameTopClipsSectionProps = {
  slug: string
  viewerId: string | undefined
  window: ClipFeedWindow
}

export function GameTopClipsSection({
  slug,
  viewerId,
  window,
}: GameTopClipsSectionProps) {
  const { data: rows, error } = useGameTopClipsQuery(slug, window, {
    limit: 5,
  })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `game-${slug}-top-clips-${window}-error`,
  })

  return (
    <TopClipsSectionBase
      listKey={`game:${slug}:top:${window}`}
      seed={`game-${slug}-top-${window}`}
      rows={rows}
      error={error}
      owned={(row) => row.authorId === viewerId}
      emptyTitle={topClipsEmptyTitle(window, "for this game")}
      emptyHint="Upload something or check back later."
      actions={
        <SortDropdown
          value={window}
          options={TOP_CLIPS_WINDOW_OPTIONS}
          contentClassName="w-40"
          renderOptionLink={(opt, active) => (
            <Link
              to="/g/$slug"
              params={{ slug }}
              search={(prev: GameSearch) => ({
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
