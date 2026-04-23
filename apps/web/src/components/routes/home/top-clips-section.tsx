import * as React from "react"
import { FlameIcon } from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@workspace/ui/components/carousel"
import { Chip } from "@workspace/ui/components/chip"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardTrigger } from "@/components/clip/clip-card-trigger"
import { ClipCardSkeleton } from "@/components/clip/clip-card-skeleton"
import { ClipGrid } from "@/components/clip/clip-grid"
import { ClipListProvider, type ClipListEntry } from "@/components/clip/clip-list-context"
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
  isPending: boolean
}

const TOP_WINDOWS: ReadonlyArray<{ key: ClipFeedWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

function TopWindowPicker({
  window,
  onChange,
}: {
  window: ClipFeedWindow
  onChange: (next: ClipFeedWindow) => void
}) {
  return (
    <SectionActions>
      {TOP_WINDOWS.map((item) => (
        <Chip
          key={item.key}
          data-active={window === item.key ? "true" : undefined}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </Chip>
      ))}
    </SectionActions>
  )
}

export function TopClipsSection({ viewerId }: TopClipsSectionProps) {
  const [window, setWindow] = React.useState<ClipFeedWindow>("today")
  const {
    data: rows,
    error,
    isPending,
  } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
  })

  return (
    <section>
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
        isPending={isPending}
      />
    </section>
  )
}

function TopClipsBody({
  viewerId,
  window,
  rows,
  error,
  isPending,
}: TopClipsBodyProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      (rows ?? []).map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
        row,
      })),
    [rows]
  )

  if (error) {
    return (
      <EmptyState
        seed={`top-${window}-error`}
        size="md"
        title="Couldn't load top clips"
      />
    )
  }

  if (isPending || !rows) return <TopClipsSkeletons />

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

function TopClipsSkeletons() {
  return (
    <>
      <div className="sm:hidden">
        <TopClipsCarousel>
          {Array.from({ length: 3 }).map((_, i) => (
            <CarouselItem key={i} className="basis-full pl-0">
              <div className="px-2">
                <div className="mx-auto w-full max-w-3xl">
                  <ClipCardSkeleton />
                </div>
              </div>
            </CarouselItem>
          ))}
        </TopClipsCarousel>
      </div>
      <div className="hidden sm:block">
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      </div>
    </>
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
      <div className="sm:hidden">
        <TopClipsCarousel>
          {rows.map((row) => (
            <CarouselItem key={row.id} className="basis-full pl-0">
              <div className="px-2">
                <ClipCardTrigger
                  row={row}
                  owned={row.authorId === viewerId}
                  className="mx-auto w-full max-w-3xl"
                  metaVariant="showcase"
                />
              </div>
            </CarouselItem>
          ))}
        </TopClipsCarousel>
      </div>
      <div className="hidden sm:block">
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

function TopClipsCarousel({ children }: { children: React.ReactNode }) {
  return (
    <Carousel className="group" opts={{ align: "start" }}>
      <CarouselContent className="-ml-0">{children}</CarouselContent>
      <CarouselPrevious
        variant="ghost"
        size="icon"
        className="top-[calc(50%-1.75rem)] left-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]"
      />
      <CarouselNext
        variant="ghost"
        size="icon"
        className="top-[calc(50%-1.75rem)] right-2 z-10 rounded-none border-transparent bg-transparent text-white shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-9 [&_svg]:stroke-[2.5]"
      />
    </Carousel>
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
  }
}
