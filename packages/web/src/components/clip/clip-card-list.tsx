import type { ClipRow } from "@alloy/api"
import { useMemo } from "react"

import { ClipCardTrigger } from "./clip-card-trigger"
import { ClipGrid } from "./clip-grid"
import { type ClipListEntry, ClipListProvider } from "./clip-list-context"

type ClipCardListProps = {
  rows: readonly ClipRow[]
  isOwnedByViewer?: (row: ClipRow) => boolean
  listKey?: string
}

export function ClipCardList({
  rows,
  isOwnedByViewer,
  listKey,
}: ClipCardListProps) {
  const entries = useMemo<ClipListEntry[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        gameId: row.gameRef ? row.gameRef.slug : null,
        row,
      })),
    [rows],
  )
  const grid = (
    <ClipGrid>
      {rows.map((row) => (
        <ClipCardTrigger
          key={row.id}
          row={row}
          showVisibilityStatus={isOwnedByViewer?.(row) ?? false}
        />
      ))}
    </ClipGrid>
  )
  if (!listKey) return grid
  return (
    <ClipListProvider listKey={listKey} entries={entries}>
      {grid}
    </ClipListProvider>
  )
}
