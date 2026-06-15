import { TopClipsSection as TopClipsSectionBase } from "@/components/clip/top-clips-section"
import { useGameTopClipsQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type GameTopClipsSectionProps = {
  slug: string
  viewerId: string | undefined
}

export function GameTopClipsSection({
  slug,
  viewerId,
}: GameTopClipsSectionProps) {
  const { data: rows, error } = useGameTopClipsQuery(slug, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `game-${slug}-top-clips-error`,
  })

  return (
    <TopClipsSectionBase
      listKey={`game:${slug}:top`}
      seed={`game-${slug}-top`}
      rows={rows}
      error={error}
      owned={(row) => row.authorId === viewerId}
      emptyTitle="No top clips for this game yet"
      emptyHint="Upload something or check back later."
    />
  )
}
