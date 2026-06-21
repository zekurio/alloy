import { createFileRoute, Outlet } from "@tanstack/react-router"
import { Suspense } from "react"

import { GameDetailPageInner } from "@/components/routes/game-detail/game-detail-page-inner"
import { gameClipsSort, parseGameSearch } from "@/lib/game-search"

export const Route = createFileRoute("/(app)/_app/games/$gameId")({
  validateSearch: parseGameSearch,
  component: GameDetailPage,
})

function GameDetailPage() {
  const { gameId } = Route.useParams()
  const search = Route.useSearch()
  const sort = gameClipsSort(search)

  return (
    <Suspense fallback={null}>
      <GameDetailPageInner gameId={gameId} sort={sort} />
      <Outlet />
    </Suspense>
  )
}
