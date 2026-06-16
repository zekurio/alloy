import type { ClipFeedWindow } from "@alloy/api"

import { parseClipFeedWindow } from "./clip-feed-windows"
import { searchString } from "./route-search"

export type HomeSearch = {
  window?: ClipFeedWindow
  feed?: "following"
  game?: string
}

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const window = parseClipFeedWindow(search.window)
  const game = searchString(search.game)
  return {
    ...(window ? { window: window as ClipFeedWindow } : {}),
    ...(search.feed === "following" ? { feed: "following" as const } : {}),
    ...(game ? { game } : {}),
  }
}
