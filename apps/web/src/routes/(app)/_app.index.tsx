import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { HomePageInner } from "@/components/routes/home/home-page-inner"

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: z.object({ tag: z.string().optional() }),
  component: HomePage,
})

function HomePage() {
  return (
    <React.Suspense fallback={null}>
      <HomePageInner />
    </React.Suspense>
  )
}
