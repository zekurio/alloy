import type { ClipRow } from "@alloy/api"
import * as React from "react"

import { ClipCardTrigger } from "./clip-card-trigger"
import { ClipGrid } from "./clip-grid"
import { type ClipListEntry, ClipListProvider } from "./clip-list-context"

type ClipCardListProps = {
  rows: readonly ClipRow[]
  isOwnedByViewer?: (row: ClipRow) => boolean
  listKey?: string
}

export function ClipCardList({ rows, listKey }: ClipCardListProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
        row,
      })),
    [rows],
  )
  const grid = (
    <ClipGrid>
      {rows.map((row) => (
        <ClipCardTrigger key={row.id} row={row} />
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
