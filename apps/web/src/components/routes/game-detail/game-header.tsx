import { EmptyState } from "@/components/feedback/empty-state"
import { useGameQuery } from "@/lib/game-queries"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import { GameHeaderBanner } from "./game-header-banner"
import { GameHeaderSkeleton } from "./game-header-skeleton"

type GameHeaderProps = {
  slug: string
}

export function GameHeader({ slug }: GameHeaderProps) {
  const { data: game, error, isPending } = useGameQuery(slug)
  useQueryErrorToast(error, {
    title: "Couldn't load this game",
    toastId: `game-${slug}-header-error`,
  })

  if (error) {
    return (
      <EmptyState
        seed={`game-${slug}-error`}
        size="lg"
        title="Couldn't load this game"
      />
    )
  }
  if (isPending || !game) {
    return <GameHeaderSkeleton />
  }

  return <GameHeaderBanner game={game} />
}
