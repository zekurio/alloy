import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardList } from "../../../components/clip-card-list"
import { ClipCardSkeleton } from "../../../components/clip-card-skeleton"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { useGameClipsQuery } from "../../../lib/game-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"

type RecentClipsSectionProps = {
  slug: string
  viewerId: string | undefined
}

const RECENT_LIMIT = 60

export function RecentClipsSection({
  slug,
  viewerId,
}: RecentClipsSectionProps) {
  const {
    data: rows,
    error,
    isPending,
  } = useGameClipsQuery(slug, {
    sort: "recent",
    limit: RECENT_LIMIT,
  })
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: `game-${slug}-recent-clips-error`,
  })
  const visibleRows = rows ?? null

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            Recent clips
          </SectionTitle>
        </div>
        <SectionActions>
          {visibleRows && visibleRows.length > 0 ? (
            <SectionMeta>
              {visibleRows.length} {visibleRows.length === 1 ? "clip" : "clips"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`game-${slug}-recent-error`}
          size="lg"
          title="Couldn't load clips"
        />
      ) : isPending || !rows ? (
        <ClipGrid>
          {Array.from({ length: 10 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : rows.length === 0 ? (
        <EmptyState
          seed={`game-${slug}-recent-empty`}
          size="lg"
          title="No clips for this game yet"
          hint="Upload one to get the grid started."
        />
      ) : (
        <ClipCardList
          rows={visibleRows ?? []}
          isOwnedByViewer={(row) => row.authorId === viewerId}
          listKey={`game:${slug}:recent`}
        />
      )}
    </section>
  )
}
