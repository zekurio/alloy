import { FlameIcon } from "lucide-react"

import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useGameTopClipsQuery } from "../../../lib/game-queries"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import { ClipCardSkeleton } from "./clip-card-skeleton"

type TopClipsSectionProps = {
  slug: string
  viewerId: string
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
