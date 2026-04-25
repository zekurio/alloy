import * as React from "react"
import { FlameIcon } from "lucide-react"

import { CarouselItem } from "@workspace/ui/components/carousel"
import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { Spinner } from "@workspace/ui/components/spinner"

import { ClipCardTrigger } from "@/components/clip/clip-card-trigger"
import { ClipGrid } from "@/components/clip/clip-grid"
import {
  ClipListProvider,
  type ClipListEntry,
} from "@/components/clip/clip-list-context"
import { TopClipsCarousel } from "@/components/clip/top-clips-carousel"
import { EmptyState } from "@/components/feedback/empty-state"
import { useGameTopClipsQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import type { ClipRow } from "@workspace/api"

type TopClipsSectionProps = {
  slug: string
  viewerId: string | undefined
}

export function TopClipsSection({ slug, viewerId }: TopClipsSectionProps) {
  const { data: rows, error } = useGameTopClipsQuery(slug, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `game-${slug}-top-clips-error`,
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
      </SectionHead>

      <TopClipsBody slug={slug} viewerId={viewerId} rows={rows} error={error} />
    </section>
  )
}

type TopClipsBodyProps = {
  slug: string
  viewerId: string | undefined
  rows: readonly ClipRow[] | undefined
  error: unknown
}

function TopClipsBody({ slug, viewerId, rows, error }: TopClipsBodyProps) {
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
          seed={`game-${slug}-top-empty`}
          size="md"
          title="No top clips for this game yet"
          hint="Upload something or check back later."
        />
      )
    }

    return (
      <ClipListProvider listKey={`game:${slug}:top`} entries={entries}>
        <TopClipsRows rows={rows} viewerId={viewerId} />
      </ClipListProvider>
    )
  }

  if (error) {
    return (
      <EmptyState
        seed={`game-${slug}-top-error`}
        size="md"
        title="Couldn't load top clips"
      />
    )
  }

  return <TopClipsSkeletons />
}

function TopClipsRows({
  rows,
  viewerId,
}: {
  rows: readonly ClipRow[]
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

function TopClipsSkeletons() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}
