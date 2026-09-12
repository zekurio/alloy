import {
  normalizeClipDescription,
  normalizeClipTitle,
  parseTagString,
} from "@/lib/clip-fields"
import { copyTextToClipboard } from "@/lib/clipboard"

import type { LibraryItemView } from "./library-data"

export async function copyPublishedClipLink(link: string) {
  return copyTextToClipboard(link, { action: "copy published clip link" })
}

export function savedLocalMetadata(item: LibraryItemView) {
  return {
    title: normalizeClipTitle(item.title),
    description: normalizeClipDescription(item.description ?? ""),
    tags: parseTagString(item.tags ?? ""),
    mentionIds: item.mentions.map((mention) => mention.id),
    gameId: item.displayGame?.id ?? null,
  }
}

/** The persisted trim, or null for an untrimmed or malformed capture. */
export function persistedTrim(item: LibraryItemView) {
  const startMs = finiteTrimMs(item.trimStartMs)
  const endMs = finiteTrimMs(item.trimEndMs)
  return startMs !== null && endMs !== null ? { startMs, endMs } : null
}

function finiteTrimMs(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Number(value) : null
}
