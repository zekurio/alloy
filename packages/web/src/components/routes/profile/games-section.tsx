import { GamepadIcon } from "lucide-react"
import * as React from "react"

import {
  type GameCarouselEntry,
  GameCarouselSection,
} from "@/components/game/game-carousel-section"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"
import { useProfileGamesInfiniteQuery } from "@/lib/user-queries"

type GamesSectionProps = {
  username: string
}

export function GamesSection({ username }: GamesSectionProps) {
  const gamesQuery = useProfileGamesInfiniteQuery(username)
  useQueryErrorToast(gamesQuery.error, {
    title: "Couldn't load games",
    toastId: `profile-${username}-games-error`,
  })
  const games = React.useMemo<GameCarouselEntry[] | null>(() => {
    if (!gamesQuery.data) return null
    return gamesQuery.data.pages.flat()
  }, [gamesQuery.data])

  return (
    <GameCarouselSection
      entries={games}
      error={gamesQuery.error}
      errorSeed={`profile-${username}-games-error`}
      errorTitle="Couldn't load games"
      title={
        <>
          <GamepadIcon className="text-accent" />
          Recently clipped
        </>
      }
      emptySeed="profile-games-empty"
      emptyTitle="No games yet"
      emptyHint="Upload a clip to start the list."
      size="large"
      renderLink={(game) =>
        game.slug
          ? { kind: "user-clips", username, slug: game.slug }
          : undefined
      }
      hasNextPage={gamesQuery.hasNextPage}
      isFetchingNextPage={gamesQuery.isFetchingNextPage}
      onEndReached={() => {
        if (gamesQuery.hasNextPage && !gamesQuery.isFetchingNextPage) {
          void gamesQuery.fetchNextPage()
        }
      }}
    />
  )
}
