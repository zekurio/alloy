import { createFileRoute } from "@tanstack/react-router"

import { GamesPageInner } from "@/components/routes/games/games-page-inner"
import { gamesListQueryOptions } from "@/lib/game-queries"

export const Route = createFileRoute("/(app)/_app/games/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(gamesListQueryOptions())
  },
  component: GamesPageInner,
})
