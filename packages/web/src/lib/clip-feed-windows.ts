import type { ClipFeedWindow } from "@alloy/api"

import { searchEnum } from "./route-search"

export const CLIP_FEED_WINDOW_KEYS = [
  "today",
  "week",
  "month",
  "year",
  "all",
] as const satisfies readonly ClipFeedWindow[]

export const TOP_CLIPS_WINDOW_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
] as const satisfies ReadonlyArray<{ key: ClipFeedWindow; label: string }>

export const DEFAULT_TOP_CLIPS_WINDOW: ClipFeedWindow = "today"

export function parseClipFeedWindow(
  value: unknown,
): ClipFeedWindow | undefined {
  return searchEnum(value, CLIP_FEED_WINDOW_KEYS)
}

export function topClipsEmptyTitle(
  window: ClipFeedWindow,
  subject = "",
): string {
  const suffix = subject ? ` ${subject}` : ""
  switch (window) {
    case "today":
      return `No top clips${suffix} today yet`
    case "week":
      return `No top clips${suffix} this week yet`
    case "month":
      return `No top clips${suffix} this month yet`
    case "year":
      return `No top clips${suffix} this year yet`
    case "all":
      return `No top clips${suffix} yet`
  }
}
