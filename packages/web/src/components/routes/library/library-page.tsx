import type { ClipRow } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { Chip } from "@alloy/ui/components/chip"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import { GameIcon } from "@alloy/ui/components/game-icon"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@alloy/ui/components/section-head"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import {
  ClapperboardIcon,
  CloudIcon,
  FolderInputIcon,
  HardDriveIcon,
  ImageIcon,
  LayersIcon,
  LibraryIcon,
  MonitorIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react"
import * as React from "react"

import { FilterCarousel } from "@/components/filter-carousel"
import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery } from "@/lib/clip-queries"
import {
  alloyDesktop,
  notifyLibraryCapturesChanged,
  type AlloyDesktop,
  type RecordingLibraryProjectDraft,
} from "@/lib/desktop"

import {
  buildLibraryGroups,
  enrichGroupIcon,
  enrichLibraryItem,
  type LibraryGroupView,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"
import {
  emptyKindLabel,
  filterLibraryItems,
  filterProjectDrafts,
  filterUploadedClips,
  type LibraryEntry,
  type LibraryKindFilter,
  projectDraftThumbnail,
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
  const { snapshot, error } = useLibrarySnapshot(desktop)
  const [query, setQuery] = React.useState("")
  const [kind, setKind] = React.useState<LibraryKindFilter>("all")
  const [groupKey, setGroupKey] = React.useState<string | null>(null)

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

  // Captures that collapsed into their uploaded clip count toward the clip's
  // game chip; tally them per local group so the source chips stay accurate.
  const collapsedCounts = React.useMemo(() => {
    const uploadedIds = new Set(uploaded.map((row) => row.id))
    const counts = new Map<string, number>()
    for (const item of snapshot?.items ?? []) {
      if (item.uploadedClipId && uploadedIds.has(item.uploadedClipId)) {
        counts.set(item.groupKey, (counts.get(item.groupKey) ?? 0) + 1)
      }
    }
    return counts
  }, [snapshot, uploaded])

  const groups = React.useMemo(
    () => buildLibraryGroups(localGroups, uploaded, collapsedCounts),
    [localGroups, uploaded, collapsedCounts],
  )

  const entries = React.useMemo<LibraryEntry[]>(() => {
    const active = groupKey
      ? (groups.find((group) => group.key === groupKey) ?? null)
      : null

    // A capture that finished uploading collapses into its server clip: the
    // local card disappears and the cloud card gains a "Local" marker.
    const uploadedIds = new Set(uploaded.map((row) => row.id))
    const localItems = (snapshot?.items ?? []).filter(
      (item) => !(item.uploadedClipId && uploadedIds.has(item.uploadedClipId)),
    )
    const localByClipId = new Map(
      (snapshot?.items ?? [])
        .filter((item) => item.uploadedClipId)
        .map((item) => [item.uploadedClipId as string, item]),
    )

    const local: LibraryEntry[] =
      active?.kind === "cloud"
        ? []
        : filterLibraryItems(localItems, {
            localKeys: active?.localKeys ?? null,
            kind,
            query,
          }).map((item) => {
            const view = enrichLibraryItem(item, gamesByName)
            return {
              type: "local",
              key: `local:${view.id}`,
              createdAt: view.createdAt,
              item: view,
            }
          })
    // Uploaded clips behave like the "Clips" kind; a selected source filters
    // them down to the matching game (or the cloud catch-all).
    const cloudVisible = kind === "all" || kind === "replay"
    const cloud: LibraryEntry[] = cloudVisible
      ? filterUploadedClips(uploaded, query, active).map((row) => ({
          type: "cloud",
          key: `cloud:${row.id}`,
          createdAt: row.createdAt,
          row,
          localItem: localByClipId.get(row.id) ?? null,
        }))
      : []
    const drafts: LibraryEntry[] =
      kind === "all" || kind === "replay"
        ? filterProjectDrafts(
            snapshot?.projectDrafts ?? [],
            query,
            active,
            snapshot?.items ?? [],
            uploaded,
          ).map((draft) => ({
            type: "draft",
            key: `draft:${draft.id}`,
            createdAt: draft.updatedAt,
            draft,
            ...projectDraftThumbnail(draft, snapshot?.items ?? [], uploaded),
          }))
        : []
    return [...local, ...cloud, ...drafts].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
  }, [snapshot, gamesByName, uploaded, groups, groupKey, kind, query])

  const [importing, setImporting] = React.useState(false)
  const importFiles = async () => {
    const pick = desktop?.recording.importLibraryFiles
    if (!pick) return
    setImporting(true)
    try {
      const result = await pick()
      if (result.canceled) return
      if (result.failed.length > 0) {
        const [first] = result.failed
        toast.error(
          result.failed.length === 1
            ? `${first.fileName}: ${first.error}`
            : `${result.failed.length} files couldn't be imported.`,
        )
      }
      if (result.importedIds.length > 0) {
        toast.success(
          result.importedIds.length === 1
            ? "Clip imported into your library"
            : `${result.importedIds.length} clips imported into your library`,
        )
        notifyLibraryCapturesChanged()
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not import clips.",
      )
    } finally {
      setImporting(false)
    }
  }

  const loading =
    (desktop !== null && !snapshot && !error) ||
    (handle.length > 0 && uploadedQuery.isLoading)
  const hasAnything =
    (snapshot?.totalCount ?? 0) > 0 ||
    (snapshot?.projectDrafts.length ?? 0) > 0 ||
    uploaded.length > 0

  return (
    <AppMain>
      <section className="flex w-full flex-col gap-6">
        <div>
          <SectionHead>
            <div>
              <SectionTitle>
                <LibraryIcon className="text-accent" />
                Library
              </SectionTitle>
            </div>
            {desktop ? (
              <SectionActions>
                {desktop.recording.importLibraryFiles ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={importing}
                    onClick={() => {
                      void importFiles()
                    }}
                  >
                    <FolderInputIcon />
                    {importing ? "Importing..." : "Import clips"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void navigate({ to: "/editor" })
                  }}
                >
                  <ClapperboardIcon />
                  New project
                </Button>
              </SectionActions>
            ) : null}
          </SectionHead>

          <LibraryToolbar
            groups={groups}
            query={query}
            kind={kind}
            groupKey={groupKey}
            onQueryChange={setQuery}
            onKindChange={setKind}
            onGroupChange={setGroupKey}
          />
        </div>

        <LibraryBody
          entries={entries}
          loading={loading}
          error={error}
          hasAnything={hasAnything}
          query={query}
          kind={kind}
          onOpenLocal={(item) => {
            void navigate({
              to: "/library/$captureId",
              params: { captureId: item.id },
            })
          }}
          onOpenCloud={(row) => {
            void navigate({
              to: "/library/c/$clipId",
              params: { clipId: row.id },
            })
          }}
          onOpenDraft={(draft) => {
            void navigate({
              to: "/editor",
              search: { draft: draft.id },
            })
          }}
          onReveal={(id) => {
            void desktop?.recording.revealLibraryCapture(id)
          }}
        />
      </section>
    </AppMain>
  )
}

function LibraryToolbar({
  groups,
  query,
  kind,
  groupKey,
  onQueryChange,
  onKindChange,
  onGroupChange,
}: {
  groups: LibraryGroupView[]
  query: string
  kind: LibraryKindFilter
  groupKey: string | null
  onQueryChange: (query: string) => void
  onKindChange: (kind: LibraryKindFilter) => void
  onGroupChange: (groupKey: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <InputGroup className="h-8 min-w-0 flex-1 sm:h-8 sm:w-64 sm:flex-none">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            placeholder="Search media..."
            aria-label="Search clips"
            onChange={(event) => onQueryChange(event.target.value)}
            className="text-sm"
          />
        </InputGroup>
        <KindSelect kind={kind} onKindChange={onKindChange} />
      </div>

      <FilterCarousel className="min-w-0 flex-1">
        <Chip
          size="xl"
          data-active={groupKey === null ? "true" : undefined}
          onClick={() => onGroupChange(null)}
        >
          All games
        </Chip>
        {groups.map((group) => (
          <Chip
            key={group.key}
            size="xl"
            title={
              group.kind === "cloud"
                ? "Clips uploaded to the server"
                : group.label
            }
            data-active={groupKey === group.key ? "true" : undefined}
            onClick={() => onGroupChange(group.key)}
          >
            {group.kind === "desktop" ? (
              <MonitorIcon />
            ) : group.kind === "cloud" ? (
              <CloudIcon />
            ) : (
              <GameIcon src={group.iconUrl} name={group.label} />
            )}
            <span className="max-w-36 truncate">{group.label}</span>
            <span className="text-foreground-faint tabular-nums">
              {group.totalCount}
            </span>
          </Chip>
        ))}
      </FilterCarousel>
    </div>
  )
}

const KIND_OPTIONS: ReadonlyArray<{
  value: LibraryKindFilter
  label: string
  icon: React.ReactNode
}> = [
  { value: "all", label: "All", icon: <LayersIcon /> },
  { value: "replay", label: "Clips", icon: <ClapperboardIcon /> },
  { value: "long-recording", label: "Sessions", icon: <VideoIcon /> },
  { value: "screenshot", label: "Screenshots", icon: <ImageIcon /> },
]

function KindSelect({
  kind,
  onKindChange,
}: {
  kind: LibraryKindFilter
  onKindChange: (kind: LibraryKindFilter) => void
}) {
  const active = KIND_OPTIONS.find((option) => option.value === kind)

  return (
    <Select
      value={kind}
      onValueChange={(value) => onKindChange(value as LibraryKindFilter)}
    >
      <SelectTrigger
        size="sm"
        className="w-40 shrink-0"
        aria-label="Filter by type"
      >
        <SelectValue>
          {active ? (
            <>
              {active.icon}
              {active.label}
            </>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      {/* Drop straight below the trigger instead of overlaying the selected
          item on it — the latter nudges the label sideways as it opens. */}
      <SelectContent align="start" alignItemWithTrigger={false}>
        {KIND_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.icon}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LibraryBody({
  entries,
  loading,
  error,
  hasAnything,
  query,
  kind,
  onOpenLocal,
  onOpenCloud,
  onOpenDraft,
  onReveal,
}: {
  entries: LibraryEntry[]
  loading: boolean
  error: string | null
  hasAnything: boolean
  query: string
  kind: LibraryKindFilter
  onOpenLocal: (item: LibraryItemView) => void
  onOpenCloud: (row: ClipRow) => void
  onOpenDraft: (draft: RecordingLibraryProjectDraft) => void
  onReveal: (id: string) => void
}) {
  if (entries.length === 0) {
    if (error) {
      return (
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title="Couldn't scan the library"
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
          title="No clips yet"
          description="Captures saved by Alloy and clips you upload will appear here."
        />
      )
    }

    return (
      <LibraryEmpty
        icon={<LibraryIcon />}
        title="No clips match"
        description={
          query.trim()
            ? "Try a different search or source filter."
            : `No ${emptyKindLabel(kind)} in this source yet.`
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-5 [&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]">
      {entries.map((entry) =>
        entry.type === "local" ? (
          <LibraryCaptureCard
            key={entry.key}
            item={entry.item}
            onOpen={() => onOpenLocal(entry.item)}
            onReveal={() => onReveal(entry.item.id)}
          />
        ) : entry.type === "cloud" ? (
          <UploadedClipCard
            key={entry.key}
            row={entry.row}
            localItem={entry.localItem}
            onOpen={() => onOpenCloud(entry.row)}
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
    </div>
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
    <Empty className="border-border bg-surface/40 min-h-[22rem] border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  )
}
