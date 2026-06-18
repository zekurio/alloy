import type { ClipFeedWindow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"

import { searchEnum } from "./route-search"

export const CLIP_FEED_WINDOW_KEYS = [
  "today",
  "week",
  "month",
  "year",
  "all",
] as const satisfies readonly ClipFeedWindow[]

export const TOP_CLIPS_WINDOW_OPTIONS = [
  { key: "today", label: tx("Today") },
  { key: "week", label: tx("Week") },
  { key: "month", label: tx("Month") },
  { key: "year", label: tx("Year") },
  { key: "all", label: tx("All time") },
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
  switch (window) {
    case "today":
      return subject
        ? tx("No top clips {subject} today yet", { subject })
        : tx("No top clips today yet")
    case "week":
      return subject
        ? tx("No top clips {subject} this week yet", { subject })
        : tx("No top clips this week yet")
    case "month":
      return subject
        ? tx("No top clips {subject} this month yet", { subject })
        : tx("No top clips this month yet")
    case "year":
      return subject
        ? tx("No top clips {subject} this year yet", { subject })
        : tx("No top clips this year yet")
    case "all":
      return subject
        ? tx("No top clips {subject} yet", { subject })
        : tx("No top clips yet")
  }
}
