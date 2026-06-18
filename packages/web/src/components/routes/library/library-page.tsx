import type { ClipRow, GameRow } from "@alloy/api"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { Chip } from "@alloy/ui/components/chip"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Input } from "@alloy/ui/components/input"
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
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  BanIcon,
  ClapperboardIcon,
  FolderInputIcon,
  HardDriveIcon,
  ImageIcon,
  LayersIcon,
  LibraryIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react"
import * as React from "react"

import { FilterCarousel } from "@/components/filter-carousel"
import { GameCombobox } from "@/components/game/game-combobox"
import { useSession } from "@/lib/auth-client"
import { CLIP_TITLE_MAX, normalizeClipTitle } from "@/lib/clip-fields"
import { useUserClipsQuery, warmClipDetailCache } from "@/lib/clip-queries"
import {
  alloyDesktop,
  type AlloyDesktop,
  type RecordingLibraryProjectDraft,
  type RecordingLibraryStagedImport,
} from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import {
  buildLibraryGroups,
  enrichGroupIcon,
  formatLibraryBytes,
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
  const importFiles = useLibraryImportAction({ desktop })
  const warmCloudClip = React.useCallback(
    (row: ClipRow) => warmClipDetailCache(queryClient, row),
    [queryClient],
  )

  return (
    <AppMain>
      <section className="flex w-full flex-col gap-6">
        <div>
          <LibraryHeader
            hasDesktop={desktop !== null}
            canImport={importFiles.available}
            importing={importFiles.picking}
            onImport={() => {
              void importFiles.start()
            }}
            onNewProject={() => {
              void navigate({ to: "/editor" })
            }}
          />

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
        <ImportClipDetailsDialog
          staged={importFiles.staged}
          pending={importFiles.committing}
          onOpenChange={(open) => {
            if (!open) void importFiles.discard()
          }}
          onCommit={(metadata) => {
            void importFiles.commit(metadata)
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

function useLibraryImportAction({ desktop }: { desktop: AlloyDesktop | null }) {
  const navigate = useNavigate()
  const [picking, setPicking] = React.useState(false)
  const [committing, setCommitting] = React.useState(false)
  const [staged, setStaged] =
    React.useState<RecordingLibraryStagedImport | null>(null)

  const available =
    !!desktop?.recording.importLibraryFiles &&
    !!desktop.recording.commitStagedLibraryImport &&
    !!desktop.recording.discardStagedLibraryImport

  const start = React.useCallback(async () => {
    const pick = desktop?.recording.importLibraryFiles
    if (!pick || !available || picking || committing || staged) return
    setPicking(true)
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
      const [next] = result.staged
      if (next) {
        setStaged(next)
      }
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not import clip."))
    } finally {
      setPicking(false)
    }
  }, [available, committing, desktop, picking, staged])

  const discard = React.useCallback(async () => {
    const current = staged
    const discardStaged = desktop?.recording.discardStagedLibraryImport
    if (!current || !discardStaged || committing) return
    setStaged(null)
    try {
      await discardStaged(current.id)
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not clear staged import."))
    }
  }, [committing, desktop, staged])

  const commit = React.useCallback(
    async ({ title, game }: { title: string; game: GameRow }) => {
      const current = staged
      const commitStaged = desktop?.recording.commitStagedLibraryImport
      if (!current || !commitStaged || committing) return

      setCommitting(true)
      try {
        const result = await commitStaged({
          id: current.id,
          title: normalizeClipTitle(title),
          gameName: game.name,
          gameIconUrl: game.iconUrl ?? game.logoUrl,
        })
        toast.success("Clip imported into your library")
        await navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
        })
      } catch (cause) {
        toast.error(errorMessage(cause, "Could not import clip."))
      } finally {
        setCommitting(false)
      }
    },
    [committing, desktop, navigate, staged],
  )

  return { available, picking, committing, staged, start, discard, commit }
}

function LibraryHeader({
  hasDesktop,
  canImport,
  importing,
  onImport,
  onNewProject,
}: {
  hasDesktop: boolean
  canImport: boolean
  importing: boolean
  onImport: () => void
  onNewProject: () => void
}) {
  return (
    <SectionHead>
      <div>
        <SectionTitle>
          <LibraryIcon className="text-accent" />
          Library
        </SectionTitle>
      </div>
      {hasDesktop ? (
        <SectionActions>
          {canImport ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={importing}
              onClick={onImport}
            >
              <FolderInputIcon />
              {importing ? "Staging..." : "Import clip"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onNewProject}
          >
            <ClapperboardIcon />
            New project
          </Button>
        </SectionActions>
      ) : null}
    </SectionHead>
  )
}

function ImportClipDetailsDialog({
  staged,
  pending,
  onOpenChange,
  onCommit,
}: {
  staged: RecordingLibraryStagedImport | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (metadata: { title: string; game: GameRow }) => void
}) {
  const [title, setTitle] = React.useState("")
  const [game, setGame] = React.useState<GameRow | null>(null)
  const [submitted, setSubmitted] = React.useState(false)

  React.useEffect(() => {
    setTitle(staged?.title ?? "")
    setGame(null)
    setSubmitted(false)
  }, [staged?.id, staged?.title])

  const normalizedTitle = normalizeClipTitle(title)
  const titleInvalid = submitted && normalizedTitle.length === 0
  const gameInvalid = submitted && game === null

  const submit = () => {
    setSubmitted(true)
    if (pending || normalizedTitle.length === 0 || !game) return
    onCommit({ title: normalizedTitle, game })
  }

  return (
    <Dialog open={staged !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import clip</DialogTitle>
          <DialogDescription>
            Add the clip details before it enters your library.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {staged ? <StagedImportSummary staged={staged} /> : null}

            <label className="flex flex-col gap-2">
              <span className="text-foreground-muted text-xs font-semibold">
                Title
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={CLIP_TITLE_MAX}
                disabled={pending}
                aria-invalid={titleInvalid || undefined}
                placeholder="Untitled"
              />
              {titleInvalid ? (
                <span className="text-destructive text-xs">
                  Add a title to import this clip.
                </span>
              ) : null}
            </label>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="import-clip-game"
                className="text-foreground-muted text-xs font-semibold"
              >
                Game
              </label>
              <GameCombobox
                id="import-clip-game"
                value={game}
                onChange={setGame}
                disabled={pending}
                invalid={gameInvalid}
                required
                placeholder="Search game..."
                className="w-full"
                inputClassName="w-full"
              />
              {gameInvalid ? (
                <span className="text-destructive text-xs">
                  Pick a game to import this clip.
                </span>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              <FolderInputIcon />
              {pending ? "Importing..." : "Import clip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StagedImportSummary({
  staged,
}: {
  staged: RecordingLibraryStagedImport
}) {
  const details = [
    formatLibraryBytes(staged.sizeBytes),
    formatStagedDuration(staged.durationMs),
    staged.width && staged.height ? `${staged.width}x${staged.height}` : null,
  ].filter((value): value is string => value !== null)

  return (
    <div className="border-border bg-surface-raised/60 flex min-w-0 items-center gap-3 rounded-md border p-3">
      <div className="bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-md">
        <VideoIcon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-semibold">
          {staged.fileName}
        </p>
        {details.length > 0 ? (
          <p className="text-foreground-muted truncate text-xs">
            {details.join(" - ")}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function formatStagedDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
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
            placeholder="Search media..."
            aria-label="Search media"
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
              group.kind === "no-game"
                ? "Captures without a selected game"
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
        className="w-9 shrink-0 justify-center px-0 sm:w-40 sm:justify-between sm:px-3 max-sm:[&>svg:last-child]:hidden"
        aria-label="Filter by type"
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
          title="Your library is empty"
          description="Captures and uploads will appear here."
        />
      )
    }

    return (
      <LibraryEmpty
        icon={<LibraryIcon />}
        title="Nothing matches"
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
