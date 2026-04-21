import { ClipGrid } from "./clip-grid"
import { ClipCardTrigger } from "./clip-player-dialog"
import { toClipCardData } from "../lib/clip-format"
import type { ClipRow } from "../lib/clips-api"

type ClipCardListProps = {
  rows: readonly ClipRow[]
  /** Returns true for rows the viewer owns — controls the privacy pill. */
  isOwnedByViewer: (row: ClipRow) => boolean
}

export function ClipCardList({ rows, isOwnedByViewer }: ClipCardListProps) {
  return (
    <ClipGrid>
      {rows.map((row) => (
        <ClipCardTrigger
          key={row.id}
          card={toClipCardData(row)}
          owned={isOwnedByViewer(row)}
        />
      ))}
    </ClipGrid>
  )
}
