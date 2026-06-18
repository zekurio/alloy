import { t as tx } from "@alloy/i18n"
import {
  SectionActions,
  SectionHead,
  SectionMeta,
  SectionTitle,
} from "@alloy/ui/components/section-head"
import { FilmIcon } from "lucide-react"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useGameClipsQuery } from "@/lib/game-queries"
import { headerCountLabel } from "@/lib/number-format"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type RecentClipsSectionProps = {
  gameId: string
  viewerId: string | undefined
}

const RECENT_LIMIT = 60

export function RecentClipsSection({
  gameId,
  viewerId,
}: RecentClipsSectionProps) {
  const { data: rows, error } = useGameClipsQuery(gameId, {
    sort: "recent",
    limit: RECENT_LIMIT,
  })
  useQueryErrorToast(error, {
    title: tx("Couldn't load clips"),
    toastId: `game-${gameId}-recent-clips-error`,
  })
  const visibleRows = rows ?? null

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            {tx("Recent clips")}
          </SectionTitle>
        </div>
        <SectionActions>
          {visibleRows && visibleRows.length > 0 ? (
            <SectionMeta>
              {headerCountLabel(visibleRows.length, "clip")}
            </SectionMeta>
          ) : null}
        </SectionActions>
      </SectionHead>

      <ClipSectionContent
        rows={visibleRows}
        error={error}
        errorSeed={`game-${gameId}-recent-error`}
        errorTitle={tx("Couldn't load clips")}
        errorSize="lg"
        emptySeed={`game-${gameId}-recent-empty`}
        emptyTitle={tx("No clips for this game yet")}
        emptyHint="Upload one to get the grid started."
        listKey={`game:${gameId}:recent`}
        isOwnedByViewer={(row) => row.authorId === viewerId}
      />
    </section>
  )
}
