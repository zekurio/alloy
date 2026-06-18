import type { ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
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
import { SectionHead, SectionTitle } from "@alloy/ui/components/section-head"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  BanIcon,
  ClapperboardIcon,
  HardDriveIcon,
  LayersIcon,
  LibraryIcon,
  SearchIcon,
} from "lucide-react"
import * as React from "react"

import { ClipGrid } from "@/components/clip/clip-grid"
import { FilterCarousel } from "@/components/filter-carousel"
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
  emptyKindLabel,
  type LibraryEntry,
  type LibraryKindFilter,
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
  const [query, setQuery] = React.useState("")
  const [kind, setKind] = React.useState<LibraryKindFilter>("all")
  const [groupKey, setGroupKey] = React.useState<string | null>(null)
  const model = useLibraryContentModel({ desktop, query, kind, groupKey })
  const warmCloudClip = React.useCallback(
    (row: ClipRow) => warmClipDetailCache(queryClient, row),
    [queryClient],
  )

  return (
    <AppMain>
      <section className="flex w-full flex-col gap-6">
        <div>
          <LibraryHeader />

          <LibraryToolbar
            groups={model.groups}
            query={query}
            kind={kind}
            groupKey={groupKey}
            onQueryChange={setQuery}
            onKindChange={setKind}
            onGroupChange={setGroupKey}
          />
        </div>

        <LibraryBody
          entries={model.entries}
          loading={model.loading}
          error={model.error}
          hasAnything={model.hasAnything}
          query={query}
          kind={kind}
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
  query,
  kind,
  groupKey,
}: {
  desktop: AlloyDesktop | null
  query: string
  kind: LibraryKindFilter
  groupKey: string | null
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

  const entries = React.useMemo<LibraryEntry[]>(() => {
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

  const loading =
    (desktop !== null && !snapshot && !error) ||
    (handle.length > 0 && uploadedQuery.isLoading)
  const hasAnything =
    (snapshot?.totalCount ?? 0) > 0 ||
    (snapshot?.projectDrafts.length ?? 0) > 0 ||
    uploaded.length > 0

  return { groups, entries, loading, error, hasAnything }
}

function LibraryHeader() {
  return (
    <SectionHead>
      <div>
        <SectionTitle>
          <LibraryIcon className="text-accent" />
          {tx("Library")}
        </SectionTitle>
      </div>
    </SectionHead>
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
        <InputGroup className="min-w-0 flex-1 sm:w-64 sm:flex-none">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            placeholder={tx("Search media...")}
            aria-label={tx("Search media")}
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
          {tx("All games")}
        </Chip>
        {groups.map((group) => (
          <Chip
            key={group.key}
            size="xl"
            title={
              group.kind === "no-game"
                ? tx("Captures without a selected game")
                : group.label
            }
            data-active={groupKey === group.key ? "true" : undefined}
            onClick={() => onGroupChange(group.key)}
          >
            {group.kind === "no-game" ? (
              <BanIcon />
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
  { value: "all", label: tx("All"), icon: <LayersIcon /> },
  { value: "replay", label: tx("Clips"), icon: <ClapperboardIcon /> },
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
        className="w-9 shrink-0 justify-center px-0 sm:w-40 sm:justify-between sm:px-3 max-sm:[&>svg:last-child]:hidden"
        aria-label={tx("Filter by type")}
      >
        <SelectValue className="max-sm:justify-center">
          {active ? (
            <>
              {active.icon}
              <span className="sr-only sm:not-sr-only">{active.label}</span>
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
  onCloudIntent,
  onOpenDraft,
}: {
  entries: LibraryEntry[]
  loading: boolean
  error: string | null
  hasAnything: boolean
  query: string
  kind: LibraryKindFilter
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
        title={tx("Nothing matches")}
        description={
          query.trim()
            ? tx("Try a different search or source filter.")
            : tx("No {kind} in this source yet.", {
                kind: emptyKindLabel(kind),
              })
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
