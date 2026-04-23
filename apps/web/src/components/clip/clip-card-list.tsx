import * as React from "react"

import type { ClipRow } from "@workspace/api"

import { ClipCardTrigger } from "./clip-card-trigger"
import { ClipListProvider, type ClipListEntry } from "./clip-list-context"
import { ClipGrid } from "./clip-grid"

type ClipCardListProps = {
  rows: readonly ClipRow[]
  /** Returns true for rows the viewer owns — controls the privacy pill. */
  isOwnedByViewer: (row: ClipRow) => boolean
  listKey?: string
}

export function ClipCardList({
  rows,
  isOwnedByViewer,
  listKey,
}: ClipCardListProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        gameSlug: row.gameRef?.slug ?? null,
      })),
    [rows]
  )
  const grid = (
    <ClipGrid>
      {rows.map((row) => (
        <ClipCardTrigger key={row.id} row={row} owned={isOwnedByViewer(row)} />
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
