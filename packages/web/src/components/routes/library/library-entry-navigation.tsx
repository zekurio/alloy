import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useMemo } from "react"

import { compareLibraryItemNewestFirst } from "@/components/clip/use-local-clip-playback"
import { useSession } from "@/lib/auth-client"
import {
  flattenUserClipPages,
  userClipsInfiniteQueryOptions,
  warmClipDetailCache,
} from "@/lib/clip-queries"
import { alloyDesktop } from "@/lib/desktop"
import {
  libraryMedia,
  librarySort,
  librarySource,
  type LibrarySearch,
  parseLibrarySearch,
} from "@/lib/library-search"

import {
  enrichLibraryItem,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import { buildLibraryEntries, type LibraryEntry } from "./library-entries"

export type NavigableLibraryEntry = Extract<
  LibraryEntry,
  { type: "local" | "cloud" }
>

export type CurrentLibraryEntry =
  | { type: "local"; id: string }
  | { type: "cloud"; id: string }

/**
 * The library grid's filters, carried into the editor routes through the URL
 * so prev/next and "back" mirror the grid the item was opened from.
 */
export function useLibrarySearch(): LibrarySearch {
  const search = useSearch({ strict: false })
  return useMemo(() => parseLibrarySearch(search), [search])
}

export function useLibraryEntryNavigation(current: CurrentLibraryEntry) {
  const desktop = alloyDesktop()
  const { snapshot, error, refreshing, refresh } = useLibrarySnapshot(desktop)
  const gamesByName = useLibraryGameLookup(snapshot)
  const { data: session } = useSession()
  const search = useLibrarySearch()
  const media = libraryMedia(search)
  const sort = librarySort(search)
  // The same paged list as the grid, so the pages it loaded carry over.
  const uploadedQuery = useInfiniteQuery(
    userClipsInfiniteQueryOptions(session?.user?.username ?? "", sort),
  )
  const uploaded = useMemo(
    () => flattenUserClipPages(uploadedQuery.data?.pages),
    [uploadedQuery.data],
  )
  const uploadedComplete = !uploadedQuery.hasNextPage
  // Mirrors the library page: without the desktop API there are no local
  // captures, so a stray ?source= must not empty the list.
  const source = desktop ? librarySource(search) : "all"

  const entries = useMemo(() => {
    // Editor navigation walks the same filtered, ordered list as the grid the
    // item was opened from, so it never crosses into a hidden media kind.
    return buildLibraryEntries({
      snapshot,
      gamesByName,
      uploaded,
      uploadedComplete,
      active: null,
      media,
      source,
      query: "",
      sort,
    }).filter(isNavigableEntry)
  }, [snapshot, gamesByName, uploaded, uploadedComplete, media, source, sort])
  const index = entries.findIndex((entry) =>
    entryMatchesCurrent(entry, current),
  )
  // A current item that is already loaded but hidden by the grid's filters
  // has no neighbours to reach, so the remaining pages are not walked for it.
  const currentLoaded = useMemo(() => {
    if (current.type === "cloud") {
      return uploaded.some((row) => row.id === current.id)
    }
    const item = snapshot?.items.find(
      (candidate) => candidate.id === current.id,
    )
    if (!item) return false
    return (
      !item.uploadedClipId ||
      uploaded.some((row) => row.id === item.uploadedClipId)
    )
  }, [current, uploaded, snapshot])
  // Load the next page when the current item is the last loaded entry (so
  // "next" can reach past it) or isn't loaded yet (opened from a deep link).
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = uploadedQuery
  const needsNextPage =
    hasNextPage &&
    !isFetchingNextPage &&
    !isFetchNextPageError &&
    (index < 0 ? !currentLoaded : index === entries.length - 1)
  useEffect(() => {
    if (needsNextPage) void fetchNextPage()
  }, [needsNextPage, fetchNextPage])
  const directLocalItem =
    current.type === "local"
      ? (snapshot?.items.find((item) => item.id === current.id) ?? null)
      : null
  const directLocalEntry = directLocalItem
    ? ({
        type: "local",
        key: `local:${directLocalItem.id}`,
        listedAt: directLocalItem.createdAt,
        status: "local",
        item: enrichLibraryItem(directLocalItem, gamesByName),
      } satisfies NavigableLibraryEntry)
    : null
  const linkedCloudEntry =
    current.type === "local" && directLocalItem?.uploadedClipId
      ? (entries.find(
          (entry) =>
            entry.type === "cloud" &&
            entry.row.id === directLocalItem.uploadedClipId,
        ) ?? null)
      : null
  const currentEntry =
    current.type === "local" && linkedCloudEntry
      ? linkedCloudEntry
      : current.type === "local" && directLocalEntry
        ? directLocalEntry
        : index >= 0
          ? entries[index]
          : null
  const linkedLocalItem =
    current.type === "cloud"
      ? ((snapshot?.items ?? [])
          .filter((item) => item.uploadedClipId === current.id)
          .sort(compareLibraryItemNewestFirst)[0] ?? null)
      : null
  const localItem =
    current.type === "local"
      ? directLocalItem
      : currentEntry?.type === "cloud"
        ? (currentEntry.localItem ?? linkedLocalItem)
        : linkedLocalItem

  return {
    entries,
    currentEntry,
    prevEntry: index > 0 ? entries[index - 1] : null,
    nextEntry:
      index >= 0 && index < entries.length - 1 ? entries[index + 1] : null,
    localItem,
    snapshot,
    error,
    refreshing,
    refresh,
  }
}

function isNavigableEntry(entry: LibraryEntry): entry is NavigableLibraryEntry {
  return entry.type === "local" || entry.type === "cloud"
}

function entryMatchesCurrent(
  entry: NavigableLibraryEntry,
  current: CurrentLibraryEntry,
): boolean {
  switch (current.type) {
    case "local":
      if (entry.type === "local") return entry.item.id === current.id
      return entry.localItems.some((item) => item.id === current.id)
    case "cloud":
      return entry.type === "cloud" && entry.row.id === current.id
  }
  return false
}

export function useNavigateToLibraryEntry() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = useLibrarySearch()
  return useCallback(
    (entry: NavigableLibraryEntry, replace = true) => {
      if (entry.type === "local") {
        void navigate({
          to: "/library/$captureId",
          params: { captureId: entry.item.id },
          search,
          replace,
        })
      } else if (entry.type === "cloud") {
        warmClipDetailCache(queryClient, entry.row)
        void navigate({
          to: "/library/clips/$clipId",
          params: { clipId: entry.row.id },
          search,
          replace,
        })
      }
    },
    [navigate, queryClient, search],
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
        side === "left" ? t("Previous library item") : t("Next library item")
      }
      title={
        side === "left" ? t("Previous library item") : t("Next library item")
      }
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
  hasUnsavedEdits,
  onDelete,
  togglePlayback,
}: {
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  /** Leaving shortcuts are ignored while true, so a stray key can't drop edits. */
  hasUnsavedEdits: boolean
  onDelete: () => void
  togglePlayback: () => void
}) {
  const navigateToEntry = useNavigateToLibraryEntry()
  const deleteEntry = useEffectEvent(onDelete)
  const toggleEntryPlayback = useEffectEvent(togglePlayback)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event)) return
      if (event.key === " ") {
        event.preventDefault()
        toggleEntryPlayback()
        return
      }
      if (hasUnsavedEdits) return
      if (event.key === "ArrowLeft" && prevEntry) {
        event.preventDefault()
        navigateToEntry(prevEntry)
      } else if (event.key === "ArrowRight" && nextEntry) {
        event.preventDefault()
        navigateToEntry(nextEntry)
      } else if (event.key === "Delete") {
        event.preventDefault()
        deleteEntry()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hasUnsavedEdits, navigateToEntry, nextEntry, prevEntry])

  // Closing or reloading the window would drop the edits too; ask first.
  useEffect(() => {
    if (!hasUnsavedEdits) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [hasUnsavedEdits])
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null
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
