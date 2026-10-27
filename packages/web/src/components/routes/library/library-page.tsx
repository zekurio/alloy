import type { ClipRow } from "@alloy/api"
import type { MediaFilter } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { AppMainColumn, AppMainScroll } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { Spinner } from "@alloy/ui/components/spinner"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  AlertCircleIcon,
  BanIcon,
  CloudIcon,
  FolderXIcon,
  GlobeIcon,
  LayersIcon,
  LibraryIcon,
  MonitorIcon,
  SearchXIcon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { ClipGrid } from "@/components/clip/clip-grid"
import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import { MediaFilterControl } from "@/components/clip/media-filter-control"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { GameIcon } from "@/components/game/game-icon"
import { useDeferredSearchQuery } from "@/components/search/app-search"
import { useUploadQueue } from "@/components/upload/upload-flow-context"
import type { QueueItem } from "@/components/upload/upload-queue-types"
import { useSession } from "@/lib/auth-client"
import {
  flattenUserClipPages,
  userClipsInfiniteQueryOptions,
  warmClipDetailCache,
} from "@/lib/clip-queries"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"
import {
  type LibrarySort,
  type LibrarySource,
  toLibrarySearch,
} from "@/lib/library-search"
import { useInfiniteScrollSentinel } from "@/lib/use-infinite-scroll-sentinel"

import {
  buildLibraryGroups,
  enrichLibraryGroup,
  type LibraryGroupView,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import {
  buildLibraryEntries,
  collapsedServerCounts,
  type LibraryEntry,
} from "./library-entries"
import { LibraryCaptureCard, UploadedClipCard } from "./library-entry-cards"

const LIBRARY_SORT_OPTIONS: ReadonlyArray<SortDropdownOption<LibrarySort>> = [
  { key: "recent", label: t("Newest") },
  { key: "oldest", label: t("Oldest") },
]

const LIBRARY_SOURCE_OPTIONS: ReadonlyArray<SortDropdownOption<LibrarySource>> =
  [
    { key: "all", label: t("All sources"), icon: <LayersIcon /> },
    { key: "server", label: t("Server"), icon: <CloudIcon /> },
    { key: "local", label: t("Local"), icon: <MonitorIcon /> },
  ]

export function LibraryPage({
  sort,
  source,
  media,
}: {
  sort: LibrarySort
  source: LibrarySource
  media: MediaFilter
}) {
  return (
    <LibraryContent
      desktop={alloyDesktop()}
      sort={sort}
      source={source}
      media={media}
    />
  )
}

function LibraryContent({
  desktop,
  sort,
  source,
  media,
}: {
  desktop: AlloyDesktop | null
  sort: LibrarySort
  source: LibrarySource
  media: MediaFilter
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deferredQuery = useDeferredSearchQuery()
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const { queue } = useUploadQueue()
  // Without the desktop native API there are no local captures and the source
  // dropdown is hidden, so a stray ?source= in the URL must not blank the
  // library.
  const effectiveSource = desktop ? source : "all"
  const model = useLibraryContentModel({
    desktop,
    media,
    source: effectiveSource,
    query: deferredQuery,
    groupKey,
    sort,
  })
  // The defaults stay out of the URL; the editors get the same filters so
  // prev/next and "back" mirror this grid.
  const search = toLibrarySearch({ sort, source: effectiveSource, media })
  const warmCloudClip = useCallback(
    (row: ClipRow) => warmClipDetailCache(queryClient, row),
    [queryClient],
  )
  const transferMaps = useMemo(() => {
    const byClipId = new Map<string, QueueItem>()
    const byLocalCaptureId = new Map<string, QueueItem>()
    for (const item of queue) {
      if (item.kind === "upload") {
        byClipId.set(item.id, item)
        if (item.localCaptureId) byLocalCaptureId.set(item.localCaptureId, item)
      } else if (item.id.startsWith("download:")) {
        byClipId.set(item.id.slice("download:".length), item)
      }
    }
    return { byClipId, byLocalCaptureId }
  }, [queue])

  return (
    <AppMainColumn>
      <PageToolbar pinned rail={false}>
        <LibraryToolbar
          groups={model.groups}
          groupKey={groupKey}
          onGroupChange={setGroupKey}
        />
        <div className="flex shrink-0 items-center gap-2">
          <MediaFilterControl
            value={media}
            onChange={(next) => {
              void navigate({
                to: "/library",
                search: toLibrarySearch({
                  sort,
                  source: effectiveSource,
                  media: next,
                }),
              })
            }}
          />
          {desktop ? (
            <SortDropdown
              value={source}
              options={LIBRARY_SOURCE_OPTIONS}
              renderOptionLink={(opt, active) => (
                <Link
                  to="/library"
                  search={toLibrarySearch({ sort, source: opt.key, media })}
                  data-active={active ? "true" : undefined}
                />
              )}
            />
          ) : null}
          <SortDropdown
            value={sort}
            options={LIBRARY_SORT_OPTIONS}
            renderOptionLink={(opt, active) => (
              <Link
                to="/library"
                search={toLibrarySearch({
                  sort: opt.key,
                  source: effectiveSource,
                  media,
                })}
                data-active={active ? "true" : undefined}
              />
            )}
          />
        </div>
      </PageToolbar>
      <AppMainScroll className="!pt-0">
        <section className="flex w-full flex-col gap-6">
          <LibraryBody
            entries={model.entries}
            transferByClipId={transferMaps.byClipId}
            transferByLocalCaptureId={transferMaps.byLocalCaptureId}
            loading={model.loading}
            error={model.error}
            hasAnything={model.hasAnything}
            query={deferredQuery}
            onOpenLocal={(item) => {
              void navigate({
                to: "/library/$captureId",
                params: { captureId: item.id },
                search,
              })
            }}
            onOpenCloud={(row) => {
              warmCloudClip(row)
              void navigate({
                to: "/library/clips/$clipId",
                params: { clipId: row.id },
                search,
              })
            }}
            onCloudIntent={warmCloudClip}
          />
          <LibraryPagingSentinel paging={model.paging} />
        </section>
      </AppMainScroll>
    </AppMainColumn>
  )
}

function useLibraryContentModel({
  desktop,
  media,
  source,
  query,
  groupKey,
  sort,
}: {
  desktop: AlloyDesktop | null
  media: MediaFilter
  source: LibrarySource
  query: string
  groupKey: string | null
  sort: LibrarySort
}) {
  const { snapshot, error } = useLibrarySnapshot(desktop)

  const { data: session } = useSession()
  const handle = session?.user?.username ?? ""
  const uploadedQuery = useInfiniteQuery(
    userClipsInfiniteQueryOptions(handle, sort),
  )
  const uploaded = useMemo(
    () => flattenUserClipPages(uploadedQuery.data?.pages),
    [uploadedQuery.data],
  )
  const uploadedComplete = !uploadedQuery.hasNextPage
  const gamesByName = useLibraryGameLookup(snapshot)

  const localGroups = useMemo(
    () =>
      (snapshot?.groups ?? []).map((group) =>
        enrichLibraryGroup(group, gamesByName),
      ),
    [snapshot, gamesByName],
  )

  // Captures that collapsed into a server row count toward that row's source
  // chip; tally them per local group so the filter chips stay accurate.
  const collapsedCounts = useMemo(() => {
    const serverIds = new Set(uploaded.map((row) => row.id))
    return collapsedServerCounts(snapshot?.items ?? [], serverIds)
  }, [snapshot, uploaded])

  const groups = useMemo(
    () => buildLibraryGroups(localGroups, uploaded, collapsedCounts),
    [localGroups, uploaded, collapsedCounts],
  )

  const visibleEntries = useMemo<LibraryEntry[]>(() => {
    const active = groupKey
      ? (groups.find((group) => group.key === groupKey) ?? null)
      : null
    return buildLibraryEntries({
      snapshot,
      gamesByName,
      uploaded,
      uploadedComplete,
      active,
      media,
      source,
      query,
      sort,
    })
  }, [
    snapshot,
    gamesByName,
    uploaded,
    uploadedComplete,
    groups,
    groupKey,
    media,
    source,
    query,
    sort,
  ])
  const pagingError = uploadedQuery.isFetchNextPageError
  // A filter can hide every loaded entry while older pages may still match;
  // keep loading rather than claiming the library has nothing here.
  const loading =
    (desktop !== null && !snapshot && !error) ||
    (handle.length > 0 && uploadedQuery.isLoading) ||
    (!uploadedComplete && !pagingError)
  const hasAnything = (snapshot?.totalCount ?? 0) > 0 || uploaded.length > 0
  const paging: LibraryPaging = {
    pageCount: uploadedQuery.data?.pages.length ?? 0,
    hasNextPage: uploadedQuery.hasNextPage,
    isFetchingNextPage: uploadedQuery.isFetchingNextPage,
    error: pagingError,
    fetchNextPage: async () => {
      await uploadedQuery.fetchNextPage()
    },
  }

  return {
    groups,
    entries: visibleEntries,
    loading,
    error,
    hasAnything,
    paging,
  }
}

type LibraryPaging = {
  pageCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: boolean
  fetchNextPage: () => Promise<void>
}

function LibraryPagingSentinel({ paging }: { paging: LibraryPaging }) {
  const sentinelRef = useInfiniteScrollSentinel(
    paging.fetchNextPage,
    paging.hasNextPage && !paging.error,
    paging.isFetchingNextPage,
  )
  if (!paging.hasNextPage) return null
  return (
    <div
      // Remount per page so a sentinel still in view after a page lands (a
      // filter can hide most of it) is observed afresh and loads the next.
      key={paging.pageCount}
      ref={sentinelRef}
      className="flex min-h-6 items-center justify-center"
    >
      {paging.isFetchingNextPage ? (
        <Spinner className="size-3" />
      ) : paging.error ? (
        <div
          role="alert"
          className="text-foreground-muted flex items-center gap-2 text-xs"
        >
          <AlertCircleIcon className="text-destructive size-4" />
          <span>{t("Couldn't load more clips")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void paging.fetchNextPage()}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function LibraryToolbar({
  groups,
  groupKey,
  onGroupChange,
}: {
  groups: LibraryGroupView[]
  groupKey: string | null
  onGroupChange: (groupKey: string | null) => void
}) {
  const ALL_GAMES = "__all"
  const options: FilterChipOption<string>[] = [
    { key: ALL_GAMES, label: t("All games"), icon: <GlobeIcon /> },
    ...groups.map((group) => ({
      key: group.key,
      label: group.label,
      icon:
        group.kind === "no-game" ? (
          <BanIcon />
        ) : (
          <GameIcon src={group.iconUrl} name={group.label} />
        ),
    })),
  ]

  return (
    <FilterChipRail
      options={options}
      activeKey={groupKey ?? ALL_GAMES}
      onSelect={(key) => onGroupChange(key === ALL_GAMES ? null : key)}
    />
  )
}

function LibraryBody({
  entries,
  transferByClipId,
  transferByLocalCaptureId,
  loading,
  error,
  hasAnything,
  query,
  onOpenLocal,
  onOpenCloud,
  onCloudIntent,
}: {
  entries: LibraryEntry[]
  transferByClipId: Map<string, QueueItem>
  transferByLocalCaptureId: Map<string, QueueItem>
  loading: boolean
  error: string | null
  hasAnything: boolean
  query: string
  onOpenLocal: (item: LibraryItemView) => void
  onOpenCloud: (row: ClipRow) => void
  onCloudIntent: (row: ClipRow) => void
}) {
  if (entries.length === 0) {
    if (error) {
      return (
        <EmptyState
          icon={FolderXIcon}
          size="lg"
          fill
          title={t("Couldn't scan the library")}
          hint={error}
        />
      )
    }

    if (loading) {
      return <LoadingState className="py-16" />
    }

    if (!hasAnything) {
      return (
        <EmptyState
          icon={LibraryIcon}
          size="lg"
          fill
          title={t("Your library is empty")}
          hint={t("Captures and clips will appear here.")}
        />
      )
    }

    return (
      <EmptyState
        icon={SearchXIcon}
        size="lg"
        fill
        title={t("No captures here")}
        hint={
          query.trim()
            ? t("Try a different search or filter.")
            : t("Pick another game or add a capture.")
        }
      />
    )
  }

  return (
    <ClipGrid>
      {entries.map((entry) => {
        if (entry.type === "local") {
          return (
            <LibraryCaptureCard
              key={entry.key}
              item={entry.item}
              transfer={
                (entry.item.uploadedClipId
                  ? transferByClipId.get(entry.item.uploadedClipId)
                  : undefined) ?? transferByLocalCaptureId.get(entry.item.id)
              }
              onOpen={() => onOpenLocal(entry.item)}
            />
          )
        }
        return (
          <UploadedClipCard
            key={entry.key}
            row={entry.row}
            localItems={entry.localItems}
            localItem={entry.localItem}
            transfer={transferByClipId.get(entry.row.id)}
            onOpen={() => onOpenCloud(entry.row)}
            onIntent={() => onCloudIntent(entry.row)}
          />
        )
      })}
    </ClipGrid>
  )
}
