import type { ClipRow } from "@alloy/api"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@alloy/ui/components/section-head"
import { AwardIcon } from "lucide-react"
import * as React from "react"

import {
  type ClipListEntry,
  ClipListProvider,
} from "@/components/clip/clip-list-context"
import { TopClipsRow } from "@/components/clip/top-clips-row"
import { EmptyState } from "@/components/feedback/empty-state"

type TopClipsSectionProps = {
  /** ClipListProvider key, e.g. "home:top:week". */
  listKey: string
  /** EmptyState seed prefix; "-empty"/"-error" suffixes are appended. */
  seed: string
  /** null/undefined = still loading (unless `error` is set). */
  rows: readonly ClipRow[] | null | undefined
  error: unknown
  owned: (row: ClipRow) => boolean
  emptyTitle: string
  emptyHint?: string
  /** Optional header controls (e.g. a window sort dropdown). */
  actions?: React.ReactNode
  className?: string
}

export function TopClipsSection({
  listKey,
  seed,
  rows,
  error,
  owned,
  emptyTitle,
  emptyHint,
  actions,
  className,
}: TopClipsSectionProps) {
  const entries = React.useMemo<ClipListEntry[]>(
    () =>
      (rows ?? []).map((row) => ({
        id: row.id,
        gameId: row.gameRef ? String(row.gameRef.steamgriddbId) : null,
        row,
      })),
    [rows],
  )

  let body: React.ReactNode
  if (rows == null) {
    body = error ? (
      <EmptyState
        seed={`${seed}-error`}
        size="md"
        title="Couldn't load top clips"
      />
    ) : (
      <LoadingState />
    )
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        seed={`${seed}-empty`}
        size="md"
        title={emptyTitle}
        hint={emptyHint}
      />
    )
  } else {
    body = (
      <ClipListProvider listKey={listKey} entries={entries}>
        <TopClipsRow items={rows.map((row) => ({ row, owned: owned(row) }))} />
      </ClipListProvider>
    )
  }

  return (
    <section className={className}>
      <SectionHead>
        <div>
          <SectionTitle>
            <AwardIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
        {actions ? <SectionActions>{actions}</SectionActions> : null}
      </SectionHead>

      {body}
    </section>
  )
}
