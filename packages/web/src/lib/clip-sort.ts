import type { ClipFeedSort } from "@alloy/api"
import { t as tx } from "@alloy/i18n"

import { searchEnum } from "./route-search"

export const CLIP_SORT_KEYS = ["top", "recent"] as const

/** Feed default: newest first. "top" is the opt-in ranking. */
export const DEFAULT_CLIP_SORT: ClipFeedSort = "recent"

export const CLIP_SORT_OPTIONS: ReadonlyArray<{
  key: ClipFeedSort
  label: string
}> = [
  { key: "recent", label: tx("Recent") },
  { key: "top", label: tx("Top") },
]

export function parseClipSort(value: unknown): ClipFeedSort | undefined {
  return searchEnum(value, CLIP_SORT_KEYS)
}
