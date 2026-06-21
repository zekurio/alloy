import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { GamesPageInner } from "@/components/routes/games/games-page-inner"

export const Route = createFileRoute("/(app)/_app/games/")({
  component: GamesIndexPage,
})

function GamesIndexPage() {
  return (
    <Suspense fallback={null}>
      <GamesPageInner />
    </Suspense>
  )
}
