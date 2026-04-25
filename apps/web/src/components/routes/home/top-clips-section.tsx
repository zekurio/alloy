import * as React from "react"
import { FlameIcon } from "lucide-react"

import { CarouselItem } from "@workspace/ui/components/carousel"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { Spinner } from "@workspace/ui/components/spinner"

import { ClipCardTrigger } from "@/components/clip/clip-card-trigger"
import { ClipGrid } from "@/components/clip/clip-grid"
import { TopClipsCarousel } from "@/components/clip/top-clips-carousel"
import {
  ClipListProvider,
  type ClipListEntry,
} from "@/components/clip/clip-list-context"
import { EmptyState } from "@/components/feedback/empty-state"
import { useTopClipsQuery } from "@/lib/clip-queries"
import type { ClipFeedWindow } from "@workspace/api"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type TopClipsSectionProps = {
  viewerId: string | undefined
}

type TopClipsBodyProps = {
  viewerId: string | undefined
  window: ClipFeedWindow
  rows: ReturnType<typeof useTopClipsQuery>["data"] | undefined
  error: unknown
}

const TOP_WINDOWS: ReadonlyArray<{ key: ClipFeedWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
]

function TopWindowPicker({
  window,
  onChange,
}: {
  window: ClipFeedWindow
  onChange: (next: ClipFeedWindow) => void
}) {
  const selectedLabel =
    TOP_WINDOWS.find((item) => item.key === window)?.label ?? "Today"

  return (
    <SectionActions>
      <Select
        value={window}
        onValueChange={(next) => {
          if (typeof next === "string" && isClipFeedWindow(next)) {
            onChange(next)
          }
        }}
      >
        <SelectTrigger
          aria-label="Top clips time range"
          size="sm"
          className="min-w-32 rounded-full border-border/80 bg-surface-raised/80 px-3.5 shadow-sm"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {TOP_WINDOWS.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SectionActions>
  )
}

export function TopClipsSection({ viewerId }: TopClipsSectionProps) {
  const [window, setWindow] = React.useState<ClipFeedWindow>("today")
  const { data: rows, error } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
  })

  return (
    <section className="pb-6">
      <SectionHead>
        <div>
          <SectionTitle>
            <FlameIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
        <TopWindowPicker window={window} onChange={setWindow} />
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
    [rows]
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
    <>
      <div className="xl:hidden">
        <TopClipsCarousel>
          {rows.map((row) => (
            <CarouselItem
              key={row.id}
              className="basis-full pl-0 md:basis-1/3 md:pl-4"
            >
              <ClipCardTrigger
                row={row}
                owned={row.authorId === viewerId}
                className="mx-auto w-full max-w-3xl md:max-w-none"
                metaVariant="showcase"
              />
            </CarouselItem>
          ))}
        </TopClipsCarousel>
      </div>
      <div className="hidden xl:block">
        <ClipGrid>
          {rows.map((row) => (
            <ClipCardTrigger
              key={row.id}
              row={row}
              owned={row.authorId === viewerId}
            />
          ))}
        </ClipGrid>
      </div>
    </>
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

function isClipFeedWindow(value: string): value is ClipFeedWindow {
  return TOP_WINDOWS.some((item) => item.key === value)
}
