import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useGameClipsQuery } from "../../../lib/game-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import { ClipCardSkeleton } from "./clip-card-skeleton"

type RecentClipsSectionProps = {
  slug: string
  viewerId: string
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
            <span className="font-mono text-2xs text-foreground-faint">
              {visibleRows.length} {visibleRows.length === 1 ? "clip" : "clips"}
            </span>
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
        <ClipGrid>
          {(visibleRows ?? []).map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                variants={card.variants}
                authorHandle={card.author}
                authorId={card.authorId}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                gameRef={card.gameRef}
                gameHref={card.gameRef ? `/g/${card.gameRef.slug}` : null}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
                privacy={card.authorId === viewerId ? card.privacy : undefined}
                clipPrivacy={card.privacy}
                description={card.description}
              />
            )
          })}
        </ClipGrid>
      )}
    </section>
  )
}
