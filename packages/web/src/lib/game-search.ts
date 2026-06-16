import type { ClipFeedWindow } from "@alloy/api"

import {
  DEFAULT_TOP_CLIPS_WINDOW,
  parseClipFeedWindow,
} from "./clip-feed-windows"

export type GameSearch = {
  window?: ClipFeedWindow
}

export function parseGameSearch(search: Record<string, unknown>): GameSearch {
  const window = parseClipFeedWindow(search.window)
  return window ? { window } : {}
}

export function gameTopClipsWindow(search: GameSearch): ClipFeedWindow {
  return search.window ?? DEFAULT_TOP_CLIPS_WINDOW
}
