import * as React from "react"
import { FlameIcon } from "lucide-react"

import { Chip } from "@workspace/ui/components/chip"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardTrigger } from "../../../components/clip-player-dialog"
import { ClipGrid } from "../../../components/clip-grid"
import { EmptyState } from "../../../components/empty-state"
import { toClipCardData } from "../../../lib/clip-format"
import { useTopClipsQuery } from "../../../lib/clip-queries"
import type { ClipFeedWindow } from "../../../lib/clips-api"
import { useQueryErrorToast } from "../../../lib/use-query-error-toast"
import { ClipCardSkeleton } from "./clip-card-skeleton"

type TopClipsSectionProps = {
  viewerId: string
}

const TOP_WINDOWS: ReadonlyArray<{ key: ClipFeedWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

export function TopClipsSection({ viewerId }: TopClipsSectionProps) {
  const [window, setWindow] = React.useState<ClipFeedWindow>("today")
  const {
    data: rows,
    error,
    isPending,
  } = useTopClipsQuery(window, {
    limit: 5,
  })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
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
        <SectionActions>
          {TOP_WINDOWS.map((w) => (
            <Chip
              key={w.key}
              data-active={window === w.key ? "true" : undefined}
              onClick={() => setWindow(w.key)}
            >
              {w.label}
            </Chip>
          ))}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`top-${window}-error`}
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
          seed={`top-${window}-empty`}
          size="md"
          title={emptyTopTitle(window)}
          hint="Check back in a bit or upload your own."
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
