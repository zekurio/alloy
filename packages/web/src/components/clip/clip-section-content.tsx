import type { ClipRow } from "@alloy/api"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { AlertCircleIcon } from "lucide-react"

import { ClipCardList } from "@/components/clip/clip-card-list"
import { EmptyState } from "@/components/feedback/empty-state"

type EmptyStateSize = "sm" | "md" | "lg"

type ClipSectionContentProps = {
  rows: readonly ClipRow[] | null
  error: unknown
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
          kaomoji
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
    return (
      <EmptyState icon={AlertCircleIcon} size={errorSize} title={errorTitle} />
    )
  }

  return <LoadingState />
}
