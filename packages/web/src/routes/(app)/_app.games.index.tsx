import { createFileRoute } from "@tanstack/react-router"
import { Suspense, lazy } from "react"

import { gamesListQueryOptions } from "@/lib/game-queries"

const loadGamesPageInner = async () => {
  const module = await import("@/components/routes/games/games-page-inner")
  return { default: module.GamesPageInner }
}

const GamesPageInner = lazy(loadGamesPageInner)

export const Route = createFileRoute("/(app)/_app/games/")({
  loader: ({ context }) => {
    void loadGamesPageInner()
    void context.queryClient.prefetchQuery(gamesListQueryOptions())
  },
  component: GamesIndexPage,
})

function GamesIndexPage() {
  return (
    <Suspense fallback={null}>
      <GamesPageInner />
    </Suspense>
  )
}
