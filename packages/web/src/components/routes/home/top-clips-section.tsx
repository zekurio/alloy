import { Link } from "@tanstack/react-router"
import type { ClipFeedWindow } from "alloy-api"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "alloy-ui/components/section-head"
import { Spinner } from "alloy-ui/components/spinner"
import { AwardIcon } from "lucide-react"
import * as React from "react"

import {
  type ClipListEntry,
  ClipListProvider,
} from "@/components/clip/clip-list-context"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { TopClipsRow } from "@/components/clip/top-clips-row"
import { EmptyState } from "@/components/feedback/empty-state"
import { useTopClipsQuery } from "@/lib/clip-queries"
import type { HomeSearch } from "@/lib/home-search"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type TopClipsSectionProps = {
  viewerId: string | undefined
  window: ClipFeedWindow
}

type TopClipsBodyProps = {
  viewerId: string | undefined
  window: ClipFeedWindow
  rows: ReturnType<typeof useTopClipsQuery>["data"] | undefined
  error: unknown
}

const TOP_WINDOWS: ReadonlyArray<SortDropdownOption<ClipFeedWindow>> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
]

export function TopClipsSection({ viewerId, window }: TopClipsSectionProps) {
  const { data: rows, error } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
  })

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <AwardIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
        <SectionActions>
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
        </SectionActions>
      </SectionHead>

      <TopClipsBody
        viewerId={viewerId}
        window={window}
        rows={rows}
        error={error}
      />
    </section>
  )
}

function TopClipsBody({ viewerId, window, rows, error }: TopClipsBodyProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      (rows ?? []).map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
        row,
      })),
    [rows],
  )

  if (rows) {
    if (rows.length === 0) {
      return (
        <EmptyState
          seed={`top-${window}-empty`}
          size="md"
          title={emptyTopTitle(window)}
          hint="Check back in a bit or upload your own."
        />
      )
    }

    return (
      <ClipListProvider listKey={`home:top:${window}`} entries={entries}>
        <TopClipsRows rows={rows} viewerId={viewerId} />
      </ClipListProvider>
    )
  }

  if (error) {
    return (
      <EmptyState
        seed={`top-${window}-error`}
        size="md"
        title="Couldn't load top clips"
      />
    )
  }

  return <TopClipsSkeletons />
}

function TopClipsSkeletons() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}

function TopClipsRows({
  rows,
  viewerId,
}: {
  rows: NonNullable<TopClipsBodyProps["rows"]>
  viewerId: string | undefined
}) {
  return (
    <TopClipsRow
      items={rows.map((row) => ({
        row,
        owned: row.authorId === viewerId,
      }))}
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
