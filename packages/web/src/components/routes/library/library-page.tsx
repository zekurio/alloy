import type { ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
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
  Loader2Icon,
  MonitorIcon,
  UploadIcon,
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
import type { QueueItem } from "@/components/upload/upload-queue-types"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery, warmClipDetailCache } from "@/lib/clip-queries"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"

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
import { LibraryCaptureCard, UploadedClipCard } from "./library-entry-cards"
import {
  ImportClipDetailsDialog,
  type LibraryImportAction,
  useLibraryImportAction,
} from "./library-import-action"

export function LibraryPage() {
  return <LibraryContent desktop={alloyDesktop()} />
}

function LibraryContent({ desktop }: { desktop: AlloyDesktop | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { deferredQuery } = useAppSearch()
  const [groupKey, setGroupKey] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<LibraryStatusFilter>("all")
  const importAction = useLibraryImportAction(desktop)
  const { queue } = useUploadFlowControls()
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
          <>
            <LibraryDesktopActions
              desktop={desktop}
              importAction={importAction}
            />
            <LibraryToolbar
              groups={model.groups}
              groupKey={groupKey}
              status={status}
              statusCounts={model.statusCounts}
              onGroupChange={setGroupKey}
              onStatusChange={setStatus}
            />
          </>
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
    [
      desktop,
      importAction.available,
      importAction.committing,
      importAction.picking,
      importAction.start,
      model.groups,
      model.statusCounts,
      groupKey,
      status,
    ],
  )
  useHeaderToolbar(toolbar)
  const warmCloudClip = React.useCallback(
    (row: ClipRow) => warmClipDetailCache(queryClient, row),
    [queryClient],
  )
  const transferMaps = React.useMemo(() => {
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
    <AppMain>
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
        />
        <ImportClipDetailsDialog action={importAction} />
      </section>
    </AppMain>
  )
}

function LibraryDesktopActions({
  desktop,
  importAction,
}: {
  desktop: AlloyDesktop | null
  importAction: LibraryImportAction
}) {
  if (!desktop) return null

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      disabled={
        !importAction.available ||
        importAction.picking ||
        importAction.committing
      }
      title={
        importAction.available
          ? tx("Import clip")
          : tx("Import is unavailable in this desktop build")
      }
      onClick={() => {
        void importAction.start()
      }}
    >
      {importAction.picking ? (
        <Loader2Icon className="animate-spin" />
      ) : (
        <UploadIcon />
      )}
      {importAction.picking ? tx("Opening...") : tx("Import clip")}
    </Button>
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
  const hasAnything = (snapshot?.totalCount ?? 0) > 0 || uploaded.length > 0

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
          description={tx("Captures and clips will appear here.")}
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
