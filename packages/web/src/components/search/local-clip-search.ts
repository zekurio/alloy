import type { GameNameLookupResult } from "@alloy/api"

import type { RecordingLibrarySnapshot } from "@/lib/desktop"

import {
  enrichLibraryItem,
  type LibraryItemView,
} from "../routes/library/library-data"

export function searchLocalClips({
  snapshot,
  gamesByName,
  query,
  limit,
}: {
  snapshot: RecordingLibrarySnapshot | null
  gamesByName: Map<string, GameNameLookupResult>
  query: string
  limit: number
}): LibraryItemView[] {
  const needle = normalizeSearchText(query)
  if (!snapshot || !needle || limit <= 0) return []

  const matches: Array<{
    item: LibraryItemView
    score: number
    createdAt: number
  }> = []

  for (const item of snapshot.items) {
    const view = enrichLibraryItem(item, gamesByName)
    const score = localClipScore(view, needle)
    if (score === null) continue

    matches.push({
      item: view,
      score,
      createdAt: Date.parse(view.createdAt) || 0,
    })
  }

  return matches
    .sort((a, b) => a.score - b.score || b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((match) => match.item)
}

function localClipScore(item: LibraryItemView, needle: string): number | null {
  const title = normalizeSearchText(item.title)
  if (title.startsWith(needle)) return 0
  if (title.includes(needle)) return 1

  if (
    normalizeSearchText([
      item.displayGameName,
      item.gameName,
      item.groupLabel,
    ]).includes(needle)
  ) {
    return 2
  }

  if (
    normalizeSearchText([
      item.fileName,
      item.filename,
      item.description,
      item.tags,
      item.mentions.map((mention) => mention.username),
    ]).includes(needle)
  ) {
    return 3
  }

  return null
}

function normalizeSearchText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(normalizeSearchText).join(" ").trim()
  }
  return String(value ?? "")
    .trim()
    .toLowerCase()
}
