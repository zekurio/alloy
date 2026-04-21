import { FlameIcon } from "lucide-react"

import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardList } from "../../../components/clip-card-list"
import { ClipCardSkeleton } from "../../../components/clip-card-skeleton"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { useGameTopClipsQuery } from "../../../lib/game-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"

type TopClipsSectionProps = {
  slug: string
  viewerId: string | undefined
}

export function TopClipsSection({ slug, viewerId }: TopClipsSectionProps) {
  const {
    data: rows,
    error,
    isPending,
  } = useGameTopClipsQuery(slug, {
    limit: 5,
  })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `game-${slug}-top-clips-error`,
  })
  const visibleRows = rows ?? null

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

      {error ? (
        <EmptyState
          seed={`game-${slug}-top-error`}
          size="md"
          title="Couldn't load top clips"
        />
      ) : isPending || !rows ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : rows.length === 0 ? (
        <EmptyState
          seed={`game-${slug}-top-empty`}
          size="md"
          title="No top clips for this game yet"
          hint="Upload something or check back later."
        />
      ) : (
        <ClipCardList
          rows={visibleRows ?? []}
          isOwnedByViewer={(row) => row.authorId === viewerId}
        />
      )}
    </section>
  )
}
