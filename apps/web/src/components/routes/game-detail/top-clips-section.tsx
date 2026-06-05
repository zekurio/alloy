import * as React from "react"
import { AwardIcon } from "lucide-react"

import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { Spinner } from "@workspace/ui/components/spinner"

import {
  type ClipListEntry,
  ClipListProvider,
} from "@/components/clip/clip-list-context"
import { TopClipsRow } from "@/components/clip/top-clips-row"
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
            <AwardIcon className="text-accent" />
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
    [rows],
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
    <TopClipsRow
      items={rows.map((row) => ({
        row,
        owned: row.authorId === viewerId,
      }))}
    />
  )
}

function TopClipsSkeletons() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}
