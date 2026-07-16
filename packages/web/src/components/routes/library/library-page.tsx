import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMainColumn, AppMainScroll } from "@alloy/ui/components/app-shell"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { PageToolbar } from "@alloy/ui/components/page-toolbar"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  BanIcon,
  CloudIcon,
  FolderXIcon,
  GlobeIcon,
  LayersIcon,
  MonitorIcon,
  SearchXIcon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { ClipGrid } from "@/components/clip/clip-grid"
import {
  FilterChipRail,
  type FilterChipOption,
} from "@/components/clip/filter-chip-rail"
import {
  SortDropdown,
  type SortDropdownOption,
} from "@/components/clip/sort-dropdown"
import { EmptyState } from "@/components/feedback/empty-state"
import { useAppSearch } from "@/components/search/app-search"
import { useUploadQueue } from "@/components/upload/upload-flow-context"
import type { QueueItem } from "@/components/upload/upload-queue-types"
import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery, warmClipDetailCache } from "@/lib/clip-queries"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"
import type { LibrarySort, LibrarySource } from "@/lib/library-search"

import {
  buildLibraryGroups,
  enrichGroupIcon,
  type LibraryGroupView,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import {
  buildLibraryEntries,
  collapsedServerCounts,
  type LibraryEntry,
  type LibraryKindFilter,
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
}: {
  sort: LibrarySort
  source: LibrarySource
}) {
  return <LibraryContent desktop={alloyDesktop()} sort={sort} source={source} />
}

function LibraryContent({
  desktop,
  sort,
  source,
}: {
  desktop: AlloyDesktop | null
  sort: LibrarySort
  source: LibrarySource
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { deferredQuery } = useAppSearch()
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const { queue } = useUploadQueue()
  const model = useLibraryContentModel({
    desktop,
    kind: "all",
    // Without the desktop bridge there are no local captures and the source
    // dropdown is hidden, so a stray ?source= in the URL must not blank the
    // library.
    source: desktop ? source : "all",
    query: deferredQuery,
    groupKey,
  })
  // Entries arrive newest-first from the model; "oldest" is its mirror.
  const orderedEntries = useMemo(
    () => (sort === "oldest" ? model.entries.toReversed() : model.entries),
    [model.entries, sort],
  )
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
          {desktop ? (
            <SortDropdown
              value={source}
              options={LIBRARY_SOURCE_OPTIONS}
              renderOptionLink={(opt, active) => (
                <Link
                  to="/library"
                  search={{
                    // The default source stays out of the URL.
                    source: opt.key === "all" ? undefined : opt.key,
                    sort: sort === "recent" ? undefined : sort,
                  }}
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
                search={{
                  // The default sort stays out of the URL.
                  sort: opt.key === "recent" ? undefined : opt.key,
                  source: source === "all" ? undefined : source,
                }}
                data-active={active ? "true" : undefined}
              />
            )}
          />
        </div>
      </PageToolbar>
      <AppMainScroll>
        <section className="flex w-full flex-col gap-6">
          <LibraryBody
            entries={orderedEntries}
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
              })
            }}
            onOpenCloud={(row) => {
              warmCloudClip(row)
              void navigate({
                to: "/library/clips/$clipId",
                params: { clipId: row.id },
              })
            }}
            onCloudIntent={warmCloudClip}
          />
        </section>
      </AppMainScroll>
    </AppMainColumn>
  )
}

function useLibraryContentModel({
  desktop,
  kind,
  source,
  query,
  groupKey,
}: {
  desktop: AlloyDesktop | null
  kind: LibraryKindFilter
  source: LibrarySource
  query: string
  groupKey: string | null
}) {
  const { snapshot, error } = useLibrarySnapshot(desktop)

  const { data: session } = useSession()
  const handle = session?.user?.username ?? ""
  const uploadedQuery = useUserClipsQuery(handle)
  const uploaded = useMemo(() => uploadedQuery.data ?? [], [uploadedQuery.data])
  const gamesByName = useLibraryGameLookup(snapshot)

  const localGroups = useMemo(
    () =>
      (snapshot?.groups ?? []).map((group) =>
        enrichGroupIcon(group, gamesByName),
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
      active,
      kind,
      source,
      query,
    })
  }, [snapshot, gamesByName, uploaded, groups, groupKey, kind, source, query])
  const loading =
    (desktop !== null && !snapshot && !error) ||
    (handle.length > 0 && uploadedQuery.isLoading)
  const hasAnything = (snapshot?.totalCount ?? 0) > 0 || uploaded.length > 0

  return { groups, entries: visibleEntries, loading, error, hasAnything }
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
          kaomoji
          seed="library-empty"
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
