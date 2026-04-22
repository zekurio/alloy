import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { GamesPageInner } from "@/components/routes/games/games-page-inner"

export const Route = createFileRoute("/(app)/_app/games")({
  component: GamesPage,
})

function GamesPage() {
  return (
    <React.Suspense fallback={null}>
      <GamesPageInner />
    </React.Suspense>
  )
}
