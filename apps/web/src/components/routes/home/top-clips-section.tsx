import * as React from "react"
import { FlameIcon } from "lucide-react"

import { Chip } from "@workspace/ui/components/chip"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardList } from "@/components/clip/clip-card-list"
import { ClipCardSkeleton } from "@/components/clip/clip-card-skeleton"
import { ClipGrid } from "@/components/clip/clip-grid"
import { EmptyState } from "@/components/feedback/empty-state"
import { useTopClipsQuery } from "@/lib/clip-queries"
import type { ClipFeedWindow } from "@workspace/api"
import { useQueryErrorToast } from "@/lib/use-query-error-toast"

type TopClipsSectionProps = {
  viewerId: string | undefined
}

const TOP_WINDOWS: ReadonlyArray<{ key: ClipFeedWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

function TopWindowPicker({
  window,
  onChange,
}: {
  window: ClipFeedWindow
  onChange: (next: ClipFeedWindow) => void
}) {
  return (
    <SectionActions>
      {TOP_WINDOWS.map((item) => (
        <Chip
          key={item.key}
          data-active={window === item.key ? "true" : undefined}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </Chip>
      ))}
    </SectionActions>
  )
}

export function TopClipsSection({ viewerId }: TopClipsSectionProps) {
  const [window, setWindow] = React.useState<ClipFeedWindow>("today")
  const {
    data: rows,
    error,
    isPending,
  } = useTopClipsQuery(window, { limit: 5 })
  useQueryErrorToast(error, {
    title: "Couldn't load top clips",
    toastId: `top-clips-${window}-error`,
  })

  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FlameIcon className="text-accent" />
            Top clips
          </SectionTitle>
        </div>
        <TopWindowPicker window={window} onChange={setWindow} />
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`top-${window}-error`}
          size="md"
          title="Couldn't load top clips"
        />
      ) : isPending || !rows ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : rows.length === 0 ? (
        <EmptyState
          seed={`top-${window}-empty`}
          size="md"
          title={emptyTopTitle(window)}
          hint="Check back in a bit or upload your own."
        />
      ) : (
        <ClipCardList
          rows={rows}
          isOwnedByViewer={(row) => row.authorId === viewerId}
          listKey={`home:top:${window}`}
        />
      )}
    </section>
  )
}

function emptyTopTitle(window: ClipFeedWindow): string {
  switch (window) {
    case "today":
      return "No top clips today yet"
    case "week":
      return "No top clips this week yet"
    case "month":
      return "No top clips this month yet"
  }
}
