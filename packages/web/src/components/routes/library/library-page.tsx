import { useNavigate } from "@tanstack/react-router"
import { clipThumbnailUrl, type ClipRow } from "alloy-api"
import { AppMain } from "alloy-ui/components/app-shell"
import { Button } from "alloy-ui/components/button"
import { Chip } from "alloy-ui/components/chip"
import { ClipCard } from "alloy-ui/components/clip-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "alloy-ui/components/empty"
import { GameIcon } from "alloy-ui/components/game-icon"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "alloy-ui/components/input-group"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "alloy-ui/components/section-head"
import { Spinner } from "alloy-ui/components/spinner"
import {
  ClapperboardIcon,
  CloudIcon,
  FolderOpenIcon,
  HardDriveIcon,
  ImageIcon,
  LibraryIcon,
  MonitorIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react"
import * as React from "react"

import { FilterCarousel } from "@/components/filter-carousel"
import { useSession } from "@/lib/auth-client"
import { toClipCardData } from "@/lib/clip-format"
import { useUserClipsQuery } from "@/lib/clip-queries"
import { formatRelativeTime } from "@/lib/date-format"
import {
  alloyDesktop,
  type AlloyDesktop,
  type RecordingLibraryItem,
  type RecordingLibraryProjectDraft,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"

import {
  buildLibraryGroups,
  enrichGroupIcon,
  enrichLibraryItem,
  formatLibraryBytes,
  gameNameKey,
  type LibraryGroupView,
  type LibraryItemView,
  useLibraryGameLookup,
  useLibrarySnapshot,
} from "./library-data"

type LibraryKindFilter = "all" | "replay" | "long-recording" | "screenshot"

/** One row of the combined grid: a local capture or an uploaded clip. */
type LibraryEntry =
  | { type: "local"; key: string; createdAt: string; item: LibraryItemView }
  | { type: "cloud"; key: string; createdAt: string; row: ClipRow }
  | {
      type: "draft"
      key: string
      createdAt: string
      draft: RecordingLibraryProjectDraft
      thumbnailUrl: string | null
      thumbBlurHash: string | null
    }

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

  const groups = React.useMemo(
    () => buildLibraryGroups(localGroups, uploaded),
    [localGroups, uploaded],
  )

  const entries = React.useMemo<LibraryEntry[]>(() => {
    const active = groupKey
      ? (groups.find((group) => group.key === groupKey) ?? null)
      : null

    const local: LibraryEntry[] =
      active?.kind === "cloud"
        ? []
        : filterLibraryItems(snapshot?.items ?? [], {
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-8 max-w-72 min-w-48 flex-1 sm:h-8">
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

        <KindChip active={kind === "all"} onClick={() => onKindChange("all")}>
          All
        </KindChip>
        <KindChip
          active={kind === "replay"}
          onClick={() => onKindChange("replay")}
        >
          <ClapperboardIcon /> Clips
        </KindChip>
        <KindChip
          active={kind === "long-recording"}
          onClick={() => onKindChange("long-recording")}
        >
          <VideoIcon /> Sessions
        </KindChip>
        <KindChip
          active={kind === "screenshot"}
          onClick={() => onKindChange("screenshot")}
        >
          <ImageIcon /> Screenshots
        </KindChip>
      </div>

      <FilterCarousel>
        <Chip
          size="xl"
          data-active={groupKey === null ? "true" : undefined}
          onClick={() => onGroupChange(null)}
        >
          All sources
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

function KindChip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Chip size="xl" data-active={active ? "true" : undefined} onClick={onClick}>
      {children}
    </Chip>
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
      return (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
      )
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

function LibraryCaptureCard({
  item,
  onOpen,
  onReveal,
}: {
  item: LibraryItemView
  onOpen: () => void
  onReveal: () => void
}) {
  return (
    <ClipCard
      title={item.title}
      titleContent={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{item.title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal ${item.title}`}
            title="Reveal in folder"
            className="size-6 shrink-0 opacity-0 transition-opacity group-hover/clip-card:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              onReveal()
            }}
          >
            <FolderOpenIcon />
          </Button>
        </span>
      }
      author=""
      game={item.displayGameName}
      gameIcon={item.displayGameIconUrl}
      gameHref={item.gameSlug ? `/g/${item.gameSlug}` : null}
      views="0"
      likes="0"
      thumbnail={item.thumbnailUrl ?? undefined}
      thumbnailBlurHash={item.thumbBlurHash}
      fallbackSeed={`${item.groupLabel}:${item.id}`}
      streamUrl={item.kind === "screenshot" ? undefined : item.mediaUrl}
      thumbnailLabel={`Edit ${item.title}`}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryCardMeta
          source="local"
          sizeBytes={item.sizeBytes}
          createdAt={item.createdAt}
        />
      }
    />
  )
}

/** Grid card for an unfinished multitrack project saved from the editor. */
function ProjectDraftCard({
  draft,
  thumbnailUrl,
  thumbBlurHash,
  onOpen,
}: {
  draft: RecordingLibraryProjectDraft
  thumbnailUrl: string | null
  thumbBlurHash: string | null
  onOpen: () => void
}) {
  return (
    <ClipCard
      title={draft.title}
      author=""
      game=""
      gameIcon={null}
      gameHref={null}
      views="0"
      likes="0"
      thumbnail={thumbnailUrl ?? undefined}
      thumbnailBlurHash={thumbBlurHash}
      fallbackSeed={`draft:${draft.id}`}
      thumbnailLabel={`Open draft ${draft.title}`}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryDraftMeta
          durationMs={draft.durationMs}
          updatedAt={draft.updatedAt}
        />
      }
    />
  )
}

function LibraryDraftMeta({
  durationMs,
  updatedAt,
}: {
  durationMs: number
  updatedAt: string
}) {
  return (
    <>
      <span className="text-foreground-muted shrink-0">Draft</span>
      {durationMs > 0 ? (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatDraftDuration(durationMs)}</span>
        </>
      ) : null}
      <span className="shrink-0">·</span>
      <span className="truncate">{formatRelativeTime(updatedAt)}</span>
    </>
  )
}

/** Shared meta line for library cards: source · size · age. */
function LibraryCardMeta({
  source,
  sizeBytes,
  createdAt,
}: {
  source: "local" | "cloud"
  sizeBytes: number | null
  createdAt: string
}) {
  const Icon = source === "local" ? MonitorIcon : CloudIcon
  const label = source === "local" ? "Local" : "Server"
  const hasSize = typeof sizeBytes === "number" && sizeBytes > 0
  return (
    <>
      <span className="flex shrink-0 items-center gap-1">
        <Icon className="size-3.5" />
        {label}
      </span>
      {hasSize ? (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatLibraryBytes(sizeBytes)}</span>
        </>
      ) : null}
      <span className="shrink-0">·</span>
      <span className="truncate">{formatRelativeTime(createdAt)}</span>
    </>
  )
}

/** Grid card for a clip that already lives on the server. */
function UploadedClipCard({
  row,
  onOpen,
}: {
  row: ClipRow
  onOpen: () => void
}) {
  const card = React.useMemo(() => toClipCardData(row), [row])
  return (
    <ClipCard
      title={card.title}
      author=""
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={card.gameSlug ? `/g/${card.gameSlug}` : null}
      views={card.views}
      likes={card.likes}
      thumbnail={card.thumbnail}
      thumbnailBlurHash={card.thumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      streamUrl={card.streamUrl}
      privacy={card.privacy}
      thumbnailLabel={`Edit ${card.title}`}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryCardMeta
          source="cloud"
          sizeBytes={row.sourceSizeBytes}
          createdAt={row.createdAt}
        />
      }
    />
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

function filterLibraryItems(
  items: RecordingLibraryItem[],
  filters: {
    localKeys: string[] | null
    kind: LibraryKindFilter
    query: string
  },
): RecordingLibraryItem[] {
  const query = filters.query.trim().toLowerCase()
  const localKeys = filters.localKeys ? new Set(filters.localKeys) : null
  return items.filter((item) => {
    if (localKeys && !localKeys.has(item.groupKey)) return false
    if (filters.kind !== "all" && item.kind !== filters.kind) return false
    if (!query) return true
    return [item.title, item.groupLabel, item.fileName]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

function filterUploadedClips(
  rows: ClipRow[],
  rawQuery: string,
  active: LibraryGroupView | null,
): ClipRow[] {
  const query = rawQuery.trim().toLowerCase()
  return rows.filter((row) => {
    if (active) {
      // A desktop source holds no uploaded clips; a game source matches by
      // name; the cloud catch-all keeps only clips without a game.
      if (active.kind === "desktop") return false
      const gameName = row.gameRef?.name ?? row.game
      if (active.kind === "cloud") {
        if (gameName) return false
      } else if (active.nameKey !== gameNameKey(gameName ?? "")) {
        return false
      }
    }
    if (!query) return true
    return [
      row.title,
      row.gameRef?.name ?? row.game ?? "",
      row.description ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

function filterProjectDrafts(
  drafts: RecordingLibraryProjectDraft[],
  rawQuery: string,
  active: LibraryGroupView | null,
  localItems: RecordingLibraryItem[],
  uploaded: ClipRow[],
): RecordingLibraryProjectDraft[] {
  const query = rawQuery.trim().toLowerCase()
  const localById = new Map(localItems.map((item) => [item.id, item]))
  const uploadedById = new Map(uploaded.map((row) => [row.id, row]))
  return drafts.filter((draft) => {
    if (active && !draftMatchesGroup(draft, active, localById, uploadedById)) {
      return false
    }
    if (!query) return true
    const sourceLabels = draft.project.clips.map((clip) => {
      const local = localById.get(clip.sourceId)
      const row = uploadedById.get(clip.sourceId)
      return [
        clip.label,
        local?.title ?? "",
        local?.groupLabel ?? "",
        row?.title ?? "",
        row?.gameRef?.name ?? row?.game ?? "",
      ].join(" ")
    })
    return [draft.title, ...sourceLabels]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

function projectDraftThumbnail(
  draft: RecordingLibraryProjectDraft,
  localItems: RecordingLibraryItem[],
  uploaded: ClipRow[],
): { thumbnailUrl: string | null; thumbBlurHash: string | null } {
  const sourceId =
    draft.thumbnailSourceId ?? draft.project.clips[0]?.sourceId ?? null
  if (!sourceId) return { thumbnailUrl: null, thumbBlurHash: null }

  const local = localItems.find((item) => item.id === sourceId)
  if (local) {
    return {
      thumbnailUrl: local.thumbnailUrl,
      thumbBlurHash: local.thumbBlurHash,
    }
  }

  const row = uploaded.find((entry) => entry.id === sourceId)
  if (row?.thumbKey) {
    return {
      thumbnailUrl: clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt),
      thumbBlurHash: row.thumbBlurHash,
    }
  }
  return { thumbnailUrl: null, thumbBlurHash: null }
}

function draftMatchesGroup(
  draft: RecordingLibraryProjectDraft,
  active: LibraryGroupView,
  localById: Map<string, RecordingLibraryItem>,
  uploadedById: Map<string, ClipRow>,
): boolean {
  return draft.project.clips.some((clip) => {
    const local = localById.get(clip.sourceId)
    if (local) {
      if (active.kind === "cloud") return false
      if (active.kind === "desktop")
        return active.localKeys.includes(local.groupKey)
      return active.nameKey === gameNameKey(local.gameName ?? local.groupLabel)
    }

    const row = uploadedById.get(clip.sourceId)
    if (!row || active.kind === "desktop") return false
    const gameName = row.gameRef?.name ?? row.game
    if (active.kind === "cloud") return !gameName
    return active.nameKey === gameNameKey(gameName ?? "")
  })
}

function emptyKindLabel(kind: LibraryKindFilter) {
  switch (kind) {
    case "replay":
      return "clips"
    case "long-recording":
      return "sessions"
    case "screenshot":
      return "screenshots"
    default:
      return "captures"
  }
}

function formatDraftDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
