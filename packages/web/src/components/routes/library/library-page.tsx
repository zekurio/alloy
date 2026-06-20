import type { ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  BanIcon,
  CloudCheckIcon,
  CloudIcon,
  FunnelIcon,
  GlobeIcon,
  HardDriveIcon,
  LibraryIcon,
  MonitorIcon,
} from "lucide-react"
import * as React from "react"

import { ClipGrid } from "@/components/clip/clip-grid"
import {
  FilterDropdown,
  type FilterDropdownOption,
} from "@/components/clip/filter-dropdown"
import { useHeaderToolbar } from "@/components/layout/header-toolbar"
import { createHeaderToolbarControls } from "@/components/layout/header-toolbar-controls"
import { useAppSearch } from "@/components/search/app-search"
import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery, warmClipDetailCache } from "@/lib/clip-queries"
import {
  alloyDesktop,
  type AlloyDesktop,
  type RecordingLibraryProjectDraft,
} from "@/lib/desktop"

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
  countLibraryEntriesByStatus,
  filterLibraryEntriesByStatus,
  type LibraryEntry,
  type LibraryKindFilter,
  type LibraryStatusFilter,
} from "./library-entries"
import {
  LibraryCaptureCard,
  ProjectDraftCard,
  UploadedClipCard,
} from "./library-entry-cards"

export function LibraryPage() {
  return <LibraryContent desktop={alloyDesktop()} />
}

function LibraryContent({ desktop }: { desktop: AlloyDesktop | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { deferredQuery } = useAppSearch()
  const [groupKey, setGroupKey] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<LibraryStatusFilter>("all")
  const model = useLibraryContentModel({
    desktop,
    kind: "all",
    query: deferredQuery,
    groupKey,
    status,
  })
  const toolbar = React.useMemo(
    () =>
      createHeaderToolbarControls({
        desktop: (
          <LibraryToolbar
            groups={model.groups}
            groupKey={groupKey}
            status={status}
            statusCounts={model.statusCounts}
            onGroupChange={setGroupKey}
            onStatusChange={setStatus}
          />
        ),
        mobile: (
          <LibraryToolbar
            groups={model.groups}
            groupKey={groupKey}
            status={status}
            statusCounts={model.statusCounts}
            triggerVariant="icon"
            onGroupChange={setGroupKey}
            onStatusChange={setStatus}
          />
        ),
      }),
    [model.groups, model.statusCounts, groupKey, status],
  )
  useHeaderToolbar(toolbar)
  const warmCloudClip = React.useCallback(
    (row: ClipRow) => warmClipDetailCache(queryClient, row),
    [queryClient],
  )

  return (
    <AppMain>
      <section className="flex w-full flex-col gap-6">
        <LibraryBody
          entries={model.entries}
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
              to: "/library/c/$clipId",
              params: { clipId: row.id },
            })
          }}
          onCloudIntent={warmCloudClip}
          onOpenDraft={(draft) => {
            void navigate({
              to: "/editor",
              search: { draft: draft.id },
            })
          }}
        />
      </section>
    </AppMain>
  )
}

function useLibraryContentModel({
  desktop,
  kind,
  query,
  groupKey,
  status,
}: {
  desktop: AlloyDesktop | null
  kind: LibraryKindFilter
  query: string
  groupKey: string | null
  status: LibraryStatusFilter
}) {
  const { snapshot, error } = useLibrarySnapshot(desktop)

  const { data: session } = useSession()
  const handle = session?.user?.username ?? ""
  const uploadedQuery = useUserClipsQuery(handle)
  const uploaded = React.useMemo(
    () => uploadedQuery.data ?? [],
    [uploadedQuery.data],
  )
  const gamesByName = useLibraryGameLookup(snapshot)

  const localGroups = React.useMemo(
    () =>
      (snapshot?.groups ?? []).map((group) =>
        enrichGroupIcon(group, gamesByName),
      ),
    [snapshot, gamesByName],
  )

  // Captures that collapsed into a server row count toward that row's source
  // chip; tally them per local group so the filter chips stay accurate.
  const collapsedCounts = React.useMemo(() => {
    const serverIds = new Set(uploaded.map((row) => row.id))
    return collapsedServerCounts(snapshot?.items ?? [], serverIds)
  }, [snapshot, uploaded])

  const groups = React.useMemo(
    () => buildLibraryGroups(localGroups, uploaded, collapsedCounts),
    [localGroups, uploaded, collapsedCounts],
  )

  const visibleEntries = React.useMemo<LibraryEntry[]>(() => {
    const active = groupKey
      ? (groups.find((group) => group.key === groupKey) ?? null)
      : null
    return buildLibraryEntries({
      snapshot,
      gamesByName,
      uploaded,
      active,
      kind,
      query,
    })
  }, [snapshot, gamesByName, uploaded, groups, groupKey, kind, query])
  const statusCounts = React.useMemo(
    () => countLibraryEntriesByStatus(visibleEntries),
    [visibleEntries],
  )
  const entries = React.useMemo(
    () => filterLibraryEntriesByStatus(visibleEntries, status),
    [visibleEntries, status],
  )

  const loading =
    (desktop !== null && !snapshot && !error) ||
    (handle.length > 0 && uploadedQuery.isLoading)
  const hasAnything =
    (snapshot?.totalCount ?? 0) > 0 ||
    (snapshot?.projectDrafts.length ?? 0) > 0 ||
    uploaded.length > 0

  return { groups, entries, statusCounts, loading, error, hasAnything }
}

function LibraryToolbar({
  groups,
  groupKey,
  status,
  statusCounts,
  triggerVariant = "chip",
  onGroupChange,
  onStatusChange,
}: {
  groups: LibraryGroupView[]
  groupKey: string | null
  status: LibraryStatusFilter
  statusCounts: Record<Exclude<LibraryStatusFilter, "all">, number>
  triggerVariant?: "chip" | "icon"
  onGroupChange: (groupKey: string | null) => void
  onStatusChange: (status: LibraryStatusFilter) => void
}) {
  const ALL_GAMES = "__all"
  const options: FilterDropdownOption<string>[] = [
    { key: ALL_GAMES, label: tx("All games"), icon: <GlobeIcon /> },
    ...groups.map((group) => ({
      key: group.key,
      label: group.label,
      count: group.totalCount,
      icon:
        group.kind === "no-game" ? (
          <BanIcon />
        ) : (
          <GameIcon src={group.iconUrl} name={group.label} />
        ),
    })),
  ]
  const statusOptions: FilterDropdownOption<LibraryStatusFilter>[] = [
    {
      key: "all",
      label: tx("Any status"),
      icon: <FunnelIcon />,
      count: statusCounts.local + statusCounts.cloud + statusCounts.synced,
    },
    {
      key: "local",
      label: tx("On Device"),
      icon: <MonitorIcon />,
      count: statusCounts.local,
    },
    {
      key: "cloud",
      label: tx("On Server"),
      icon: <CloudIcon />,
      count: statusCounts.cloud,
    },
    {
      key: "synced",
      label: tx("Server + Device"),
      icon: <CloudCheckIcon />,
      count: statusCounts.synced,
    },
  ]

  return (
    <>
      <FilterDropdown
        triggerLabel={tx("Filter by game")}
        triggerVariant={triggerVariant}
        value={groupKey ?? ALL_GAMES}
        options={options}
        searchPlaceholder={tx("Search games…")}
        onSelect={(key) => onGroupChange(key === ALL_GAMES ? null : key)}
      />
      <FilterDropdown
        triggerLabel={tx("Filter by status")}
        triggerVariant={triggerVariant}
        value={status}
        options={statusOptions}
        searchThreshold={Number.POSITIVE_INFINITY}
        onSelect={onStatusChange}
      />
    </>
  )
}

function LibraryBody({
  entries,
  loading,
  error,
  hasAnything,
  query,
  onOpenLocal,
  onOpenCloud,
  onCloudIntent,
  onOpenDraft,
}: {
  entries: LibraryEntry[]
  loading: boolean
  error: string | null
  hasAnything: boolean
  query: string
  onOpenLocal: (item: LibraryItemView) => void
  onOpenCloud: (row: ClipRow) => void
  onCloudIntent: (row: ClipRow) => void
  onOpenDraft: (draft: RecordingLibraryProjectDraft) => void
}) {
  if (entries.length === 0) {
    if (error) {
      return (
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title={tx("Couldn't scan the library")}
          description={error}
        />
      )
    }

    if (loading) {
      return <LoadingState className="py-16" />
    }

    if (!hasAnything) {
      return (
        <LibraryEmpty
          icon={<LibraryIcon />}
          title={tx("Your library is empty")}
          description={tx("Captures and uploads will appear here.")}
        />
      )
    }

    return (
      <LibraryEmpty
        icon={<LibraryIcon />}
        title={tx("No captures here")}
        description={
          query.trim()
            ? tx("Try a different search or filter.")
            : tx("Pick another game or add a capture.")
        }
      />
    )
  }

  return (
    <ClipGrid>
      {entries.map((entry) =>
        entry.type === "local" ? (
          <LibraryCaptureCard
            key={entry.key}
            item={entry.item}
            onOpen={() => onOpenLocal(entry.item)}
          />
        ) : entry.type === "cloud" ? (
          <UploadedClipCard
            key={entry.key}
            row={entry.row}
            onOpen={() => onOpenCloud(entry.row)}
            onIntent={() => onCloudIntent(entry.row)}
          />
        ) : (
          <ProjectDraftCard
            key={entry.key}
            draft={entry.draft}
            thumbnailUrl={entry.thumbnailUrl}
            thumbBlurHash={entry.thumbBlurHash}
            onOpen={() => onOpenDraft(entry.draft)}
          />
        ),
      )}
    </ClipGrid>
  )
}

export function LibraryEmpty({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <Empty className="min-h-[22rem] bg-transparent">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  )
}
