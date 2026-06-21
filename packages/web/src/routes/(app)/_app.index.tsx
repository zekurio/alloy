import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import { parseHomeSearch } from "@/lib/home-search"

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: parseHomeSearch,
  component: HomePage,
})

function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  )
}
