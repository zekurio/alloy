import type { ClipRow, StagingRecordingRow } from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import * as React from "react"

import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery } from "@/lib/clip-queries"
import { alloyDesktop, type RecordingLibraryItem } from "@/lib/desktop"
import { useStagingListQuery } from "@/lib/staging-queries"

import { useLibraryGameLookup, useLibrarySnapshot } from "./library-data"
import {
  buildLibraryEntries,
  type LibraryEntry,
  type LibraryKindFilter,
} from "./library-entries"

export type NavigableLibraryEntry = Extract<
  LibraryEntry,
  { type: "local" | "cloud" | "staging" }
>

export type CurrentLibraryEntry =
  | { type: "local"; id: string }
  | { type: "cloud"; id: string }
  | { type: "staging"; id: string }

export function useLibraryEntryNavigation(current: CurrentLibraryEntry): {
  entries: NavigableLibraryEntry[]
  currentEntry: NavigableLibraryEntry | null
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  localItem: RecordingLibraryItem | null
  snapshot: ReturnType<typeof useLibrarySnapshot>["snapshot"]
  error: ReturnType<typeof useLibrarySnapshot>["error"]
  refresh: ReturnType<typeof useLibrarySnapshot>["refresh"]
} {
  const desktop = alloyDesktop()
  const { snapshot, error, refresh } = useLibrarySnapshot(desktop)
  const gamesByName = useLibraryGameLookup(snapshot)
  const { data: session } = useSession()
  const uploadedQuery = useUserClipsQuery(session?.user?.username ?? "")
  const stagingQuery = useStagingListQuery()
  const uploaded = React.useMemo(
    () => uploadedQuery.data ?? [],
    [uploadedQuery.data],
  )
  const staging = React.useMemo(
    () => stagingQuery.data ?? [],
    [stagingQuery.data],
  )

  const entries = React.useMemo(
    () =>
      buildLibraryEntries({
        snapshot,
        gamesByName,
        uploaded,
        staging,
        active: null,
        kind: "all" satisfies LibraryKindFilter,
        query: "",
        includeDrafts: false,
      }).filter(isNavigableEntry),
    [snapshot, gamesByName, uploaded, staging],
  )
  const index = entries.findIndex((entry) =>
    entryMatchesCurrent(entry, current),
  )
  const currentEntry = index >= 0 ? entries[index] : null
  const localItem =
    currentEntry?.type === "local"
      ? currentEntry.item
      : (currentEntry?.localItem ?? null)

  return {
    entries,
    currentEntry,
    prevEntry: index > 0 ? entries[index - 1] : null,
    nextEntry:
      index >= 0 && index < entries.length - 1 ? entries[index + 1] : null,
    localItem,
    snapshot,
    error,
    refresh,
  }
}

function isNavigableEntry(entry: LibraryEntry): entry is NavigableLibraryEntry {
  return (
    entry.type === "local" || entry.type === "cloud" || entry.type === "staging"
  )
}

function entryMatchesCurrent(
  entry: NavigableLibraryEntry,
  current: CurrentLibraryEntry,
): boolean {
  switch (current.type) {
    case "local":
      if (entry.type === "local") return entry.item.id === current.id
      return entry.localItem?.id === current.id
    case "cloud":
      return entry.type === "cloud" && entry.row.id === current.id
    case "staging":
      return entry.type === "staging" && entry.row.id === current.id
  }
  return false
}

export function useNavigateToLibraryEntry() {
  const navigate = useNavigate()
  return React.useCallback(
    (entry: NavigableLibraryEntry, replace = true) => {
      if (entry.type === "local") {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: entry.item.id },
          replace,
        })
      } else if (entry.type === "cloud") {
        void navigate({
          to: "/library/c/$clipId",
          params: { clipId: entry.row.id },
          replace,
        })
      } else {
        void navigate({
          to: "/library/r/$recordingId",
          params: { recordingId: entry.row.id },
          replace,
        })
      }
    },
    [navigate],
  )
}

export function LibraryEntryNavButton({
  side,
  target,
}: {
  side: "left" | "right"
  target: NavigableLibraryEntry | null
}) {
  const navigateToEntry = useNavigateToLibraryEntry()
  if (!target) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        side === "left" ? "Previous library item" : "Next library item"
      }
      title={side === "left" ? "Previous library item" : "Next library item"}
      className={cn(
        "absolute top-1/2 z-40 h-12 w-12 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
        side === "left" ? "left-2" : "right-2",
      )}
      onClick={() => navigateToEntry(target)}
    >
      {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </Button>
  )
}

export function useLibraryEditorShortcuts({
  prevEntry,
  nextEntry,
  onDelete,
  togglePlayback,
}: {
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  onDelete: () => void
  togglePlayback: () => void
}) {
  const navigateToEntry = useNavigateToLibraryEntry()
  const actionsRef = React.useRef({ onDelete, togglePlayback })
  actionsRef.current = { onDelete, togglePlayback }

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event)) return
      if (event.key === "ArrowLeft" && prevEntry) {
        event.preventDefault()
        navigateToEntry(prevEntry)
      } else if (event.key === "ArrowRight" && nextEntry) {
        event.preventDefault()
        navigateToEntry(nextEntry)
      } else if (event.key === "Delete") {
        event.preventDefault()
        actionsRef.current.onDelete()
      } else if (event.key === " ") {
        event.preventDefault()
        actionsRef.current.togglePlayback()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [navigateToEntry, nextEntry, prevEntry])
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return Boolean(
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "BUTTON" ||
      target.isContentEditable ||
      target.closest('[role="slider"]') ||
      target.closest('[role="dialog"]')),
  )
}

export function entryClipRow(
  entry: NavigableLibraryEntry | null,
): ClipRow | null {
  return entry?.type === "cloud" ? entry.row : null
}

export function entryStagingRow(
  entry: NavigableLibraryEntry | null,
): StagingRecordingRow | null {
  return entry?.type === "staging" ? entry.row : null
}
