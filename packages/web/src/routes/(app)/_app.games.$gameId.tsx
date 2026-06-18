import { createFileRoute, Outlet } from "@tanstack/react-router"
import * as React from "react"

import { GameDetailPageInner } from "@/components/routes/game-detail/game-detail-page-inner"
import { gameTopClipsWindow, parseGameSearch } from "@/lib/game-search"

export const Route = createFileRoute("/(app)/_app/games/$gameId")({
  validateSearch: parseGameSearch,
  component: GameDetailPage,
})

function GameDetailPage() {
  const { gameId } = Route.useParams()
  const search = Route.useSearch()
  const window = gameTopClipsWindow(search)

  return (
    <React.Suspense fallback={null}>
      <GameDetailPageInner gameId={gameId} window={window} />
      <Outlet />
    </React.Suspense>
  )
}
