import * as React from "react"
import { Outlet, createFileRoute } from "@tanstack/react-router"

import { GameDetailPageInner } from "@/components/routes/game-detail/game-detail-page-inner"

export const Route = createFileRoute("/(app)/_app/g/$slug")({
  component: GameDetailPage,
})

function GameDetailPage() {
  const { slug } = Route.useParams()

  return (
    <React.Suspense fallback={null}>
      <GameDetailPageInner slug={slug} />
      <Outlet />
    </React.Suspense>
  )
}
