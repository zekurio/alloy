import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import type { ClipFeedWindow } from "@workspace/api"

const WINDOW_KEYS = ["today", "week", "month", "year", "all"] as const
const windowKeys = new Set<string>(WINDOW_KEYS)

export type HomeSearch = {
  tag?: string
  window?: ClipFeedWindow
  feed?: "following"
  game?: string
}

export const Route = createFileRoute("/(app)/_app/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const { tag, window, feed, game } = search
    return {
      ...(typeof tag === "string" && tag.length > 0 ? { tag } : {}),
      ...(typeof window === "string" && windowKeys.has(window)
        ? { window: window as ClipFeedWindow }
        : {}),
      ...(feed === "following" ? { feed: "following" as const } : {}),
      ...(typeof game === "string" && game.length > 0 ? { game } : {}),
    }
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
