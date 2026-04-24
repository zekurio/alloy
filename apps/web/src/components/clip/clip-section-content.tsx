import type { ClipRow } from "@workspace/api"

import { ClipCardList } from "@/components/clip/clip-card-list"
import { ClipGridSkeleton } from "@/components/clip/clip-grid"
import { EmptyState } from "@/components/feedback/empty-state"

type EmptyStateSize = "sm" | "md" | "lg"

type ClipSectionContentProps = {
  rows: readonly ClipRow[] | null
  error: unknown
  skeletonCount?: number
  errorSeed: string
  errorTitle: string
  errorSize?: EmptyStateSize
  emptySeed: string
  emptyTitle: string
  emptyHint?: string
  emptySize?: EmptyStateSize
  listKey: string
  isOwnedByViewer: (row: ClipRow) => boolean
}

export function ClipSectionContent({
  rows,
  error,
  skeletonCount = 5,
  errorSeed,
  errorTitle,
  errorSize = "md",
  emptySeed,
  emptyTitle,
  emptyHint,
  emptySize = "lg",
  listKey,
  isOwnedByViewer,
}: ClipSectionContentProps) {
  if (rows !== null) {
    if (rows.length === 0) {
      return (
        <EmptyState
          seed={emptySeed}
          size={emptySize}
          title={emptyTitle}
          hint={emptyHint}
        />
      )
    }

    return (
      <ClipCardList
        rows={rows}
        isOwnedByViewer={isOwnedByViewer}
        listKey={listKey}
      />
    )
  }

  if (error) {
    return <EmptyState seed={errorSeed} size={errorSize} title={errorTitle} />
  }

  return <ClipGridSkeleton count={skeletonCount} />
}
