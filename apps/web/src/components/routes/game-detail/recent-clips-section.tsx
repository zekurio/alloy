import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useGameClipsQuery } from "@/lib/game-queries"
import { formatCount } from "@/lib/number-format"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type RecentClipsSectionProps = {
  slug: string
  viewerId: string | undefined
}

const RECENT_LIMIT = 60

export function RecentClipsSection({
  slug,
  viewerId,
}: RecentClipsSectionProps) {
  const { data: rows, error } = useGameClipsQuery(slug, {
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
              {formatCount(visibleRows.length)}{" "}
              {visibleRows.length === 1 ? "clip" : "clips"}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipSectionContent
        rows={visibleRows}
        error={error}
        errorSeed={`game-${slug}-recent-error`}
        errorTitle="Couldn't load clips"
        errorSize="lg"
        emptySeed={`game-${slug}-recent-empty`}
        emptyTitle="No clips for this game yet"
        emptyHint="Upload one to get the grid started."
        listKey={`game:${slug}:recent`}
        isOwnedByViewer={(row) => row.authorId === viewerId}
      />
    </section>
  )
}
