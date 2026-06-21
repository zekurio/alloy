import type { ClipFeedSort } from "@alloy/api"
import { t } from "@alloy/i18n"

import { searchEnum } from "./route-search"

export const CLIP_SORT_KEYS = ["top", "recent", "recommended"] as const

/** Feed default: newest first. Ranked feeds are opt-in. */
export const DEFAULT_CLIP_SORT: ClipFeedSort = "recent"

export const CLIP_SORT_OPTIONS: ReadonlyArray<{
  key: ClipFeedSort
  label: string
}> = [
  { key: "recent", label: t("Recent") },
  { key: "recommended", label: t("Recommended") },
  { key: "top", label: t("Top") },
]

export function parseClipSort(value: unknown): ClipFeedSort | undefined {
  return searchEnum(value, CLIP_SORT_KEYS)
}
