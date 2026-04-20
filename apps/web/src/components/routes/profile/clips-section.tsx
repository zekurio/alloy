import { FilmIcon } from "lucide-react"

import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import type { UserClip } from "../../../lib/users-api"

type ClipsSectionProps = {
  clips: UserClip[] | null
  error: Error | null
  variant: "recent" | "all"
  isSelf: boolean
}

export function ClipsSection({
  clips,
  error,
  variant,
  isSelf,
}: ClipsSectionProps) {
  useQueryErrorToast(error, {
    title: "Couldn't load clips",
    toastId: `profile-${variant}-clips-error`,
  })
  const visibleClips = clips

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            {variant === "recent" ? "Recent clips" : "All clips"}
          </SectionTitle>
        </div>
        <SectionActions>
          {visibleClips ? (
            <span className="font-mono text-2xs text-foreground-faint">
              {visibleClips.length}{" "}
              {visibleClips.length === 1 ? "clip" : "clips"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`profile-${variant}-error`}
          size="md"
          title="Couldn't load clips"
        />
      ) : clips === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </ClipGrid>
      ) : clips.length === 0 ? (
        <EmptyState
          seed={`profile-${variant}-empty`}
          size="lg"
          title="No clips uploaded yet"
          hint="Clips from this user will show up here once they upload."
        />
      ) : (
        <ClipGrid>
          {clips.map((row) => {
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
                privacy={isSelf ? card.privacy : undefined}
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
