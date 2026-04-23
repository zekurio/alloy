import { FlameIcon } from "lucide-react"

import {
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipSectionContent } from "@/components/clip/clip-section-content"
import { useGameTopClipsQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

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

      <ClipSectionContent
        rows={rows ?? null}
        loading={isPending}
        error={error}
        errorSeed={`game-${slug}-top-error`}
        errorTitle="Couldn't load top clips"
        errorSize="md"
        emptySeed={`game-${slug}-top-empty`}
        emptyTitle="No top clips for this game yet"
        emptyHint="Upload something or check back later."
        emptySize="md"
        listKey={`game:${slug}:top`}
        isOwnedByViewer={(row) => row.authorId === viewerId}
      />
    </section>
  )
}
