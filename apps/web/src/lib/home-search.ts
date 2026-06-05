import type { ClipFeedWindow } from "@workspace/api"

import { searchEnum, searchString } from "./route-search"

const WINDOW_KEYS = ["today", "week", "month", "year", "all"] as const

export type HomeSearch = {
  tag?: string
  window?: ClipFeedWindow
  feed?: "following"
  game?: string
}

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const tag = searchString(search.tag)
  const window = searchEnum(search.window, WINDOW_KEYS)
  const game = searchString(search.game)
  return {
    ...(tag ? { tag } : {}),
    ...(window ? { window: window as ClipFeedWindow } : {}),
    ...(search.feed === "following" ? { feed: "following" as const } : {}),
    ...(game ? { game } : {}),
  }
}
