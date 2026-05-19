import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"

type HomeSearch = {
  tag?: string
}

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const tag = search.tag
    return typeof tag === "string" && tag.length > 0 ? { tag } : {}
  },
  component: HomePage,
})

function HomePage() {
  return (
    <React.Suspense fallback={null}>
      <HomePageInner />
    </React.Suspense>
  )
}
