import type { ClipRow } from "@alloy/api"
import { useMemo } from "react"

import { ClipCardTrigger } from "./clip-card-trigger"
import { ClipGrid } from "./clip-grid"
import { clipListEntry, ClipListProvider } from "./clip-list-context"

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
  const entries = useMemo(() => rows.map(clipListEntry), [rows])
  const masonry = rows.some((row) => row.mediaKind === "image")
  const grid = (
    <ClipGrid masonry={masonry}>
      {rows.map((row) => (
        <ClipCardTrigger
          key={row.id}
          row={row}
          metaVariant={masonry ? "gallery" : "default"}
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
