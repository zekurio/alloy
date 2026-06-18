import { type ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { ClipCard } from "@alloy/ui/components/clip-card"
import { GlobeIcon, Link2Icon, LockIcon, MonitorIcon } from "lucide-react"
import * as React from "react"

import { gameHref } from "@/lib/app-paths"
import { useCapturePoster } from "@/lib/capture-poster"
import { toClipCardData } from "@/lib/clip-format"
import { formatRelativeTime } from "@/lib/date-format"
import { type RecordingLibraryProjectDraft } from "@/lib/desktop"

import { useClipCardGameLink } from "../../clip/clip-card-links"
import { type LibraryItemView } from "./library-data"

export function LibraryCaptureCard({
  item,
  onOpen,
}: {
  item: LibraryItemView
  onOpen: () => void
}) {
  const thumbnail = useCapturePoster({
    id: item.id,
    mediaUrl: item.mediaUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationMs: item.durationMs,
    enabled: true,
  })
  const source: LibrarySource = "local"
  const renderGameLink = useClipCardGameLink(item.gameSteamGridDBId)
  const gameUrl = item.gameSteamGridDBId
    ? gameHref(item.gameSteamGridDBId)
    : null

  return (
    <ClipCard
      title={item.title}
      titleContent={<LibraryCardTitle title={item.title} />}
      author=""
      game={item.displayGameName}
      gameIcon={item.displayGameIconUrl}
      gameHref={gameUrl}
      renderGameLink={renderGameLink}
      views="0"
      likes="0"
      thumbnail={thumbnail ?? undefined}
      thumbnailBlurHash={item.thumbBlurHash}
      fallbackSeed={`${item.groupLabel}:${item.id}`}
      streamUrl={item.mediaUrl}
      thumbnailLabel={tx("Edit {title}", { title: item.title })}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryCardMeta source={source} createdAt={item.createdAt} />
      }
    />
  )
}

/** Grid card for an unfinished multitrack project saved from the editor. */
export function ProjectDraftCard({
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
      titleContent={<LibraryCardTitle title={draft.title} />}
      author=""
      game=""
      gameIcon={null}
      gameHref={null}
      views="0"
      likes="0"
      thumbnail={thumbnailUrl ?? undefined}
      thumbnailBlurHash={thumbBlurHash}
      fallbackSeed={`draft:${draft.id}`}
      thumbnailLabel={tx("Open draft {title}", { title: draft.title })}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryDraftMeta
          source="local"
          durationMs={draft.durationMs}
          updatedAt={draft.updatedAt}
        />
      }
    />
  )
}

function LibraryDraftMeta({
  source,
  durationMs,
  updatedAt,
}: {
  source: LibrarySource
  durationMs: number
  updatedAt: string
}) {
  return (
    <>
      <LibrarySourceBadge source={source} />
      <span className="shrink-0">{"·"}</span>
      <span className="text-foreground-muted shrink-0">{tx("Draft")}</span>
      {durationMs > 0 ? (
        <>
          <span className="shrink-0">{"·"}</span>
          <span className="shrink-0">{formatDraftDuration(durationMs)}</span>
        </>
      ) : null}
      <span className="shrink-0">{"·"}</span>
      <span className="truncate">{formatRelativeTime(updatedAt)}</span>
    </>
  )
}

type LibrarySource = "local" | "link-disabled" | "link-only" | "on-profile"

/** How visible a published clip is, mirroring the privacy picker icons. */
export function librarySourceForPrivacy(
  privacy: ClipRow["privacy"],
): LibrarySource {
  if (privacy === "public") return "on-profile"
  if (privacy === "unlisted") return "link-only"
  return "link-disabled"
}

const SOURCE_META: Record<
  LibrarySource,
  {
    icon: React.ComponentType<{ className?: string }>
    label: string
  }
> = {
  local: { icon: MonitorIcon, label: tx("Local") },
  "link-disabled": { icon: LockIcon, label: tx("Private") },
  "link-only": { icon: Link2Icon, label: tx("Unlisted") },
  "on-profile": { icon: GlobeIcon, label: tx("Public") },
}

function LibraryCardTitle({ title }: { title: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{title}</span>
    </span>
  )
}

function LibrarySourceBadge({ source }: { source: LibrarySource }) {
  const { icon: SourceIcon, label } = SOURCE_META[source]
  return (
    <span
      className="text-foreground-muted inline-flex shrink-0 items-center gap-1 whitespace-nowrap opacity-80"
      title={label}
      aria-label={label}
    >
      <SourceIcon className="size-3" aria-hidden />
      <span>{label}</span>
    </span>
  )
}

/** Shared meta line for library cards: visibility · age. */
function LibraryCardMeta({
  source,
  createdAt,
}: {
  source: LibrarySource
  createdAt: string
}) {
  return (
    <>
      <LibrarySourceBadge source={source} />
      <span className="shrink-0">{"·"}</span>
      <span className="truncate">{formatRelativeTime(createdAt)}</span>
    </>
  )
}

/** Grid card for a clip that already lives on the server. */
export function UploadedClipCard({
  row,
  onOpen,
  onIntent,
}: {
  row: ClipRow
  onOpen: () => void
  onIntent?: () => void
}) {
  const card = React.useMemo(() => toClipCardData(row), [row])
  const source = librarySourceForPrivacy(row.privacy)
  const gameId = card.gameRef?.steamgriddbId ?? null
  const renderGameLink = useClipCardGameLink(gameId)
  const gameUrl = gameId ? gameHref(gameId) : null
  return (
    <ClipCard
      title={card.title}
      titleContent={<LibraryCardTitle title={card.title} />}
      author=""
      game={card.game}
      gameIcon={card.gameRef?.iconUrl ?? null}
      gameHref={gameUrl}
      renderGameLink={renderGameLink}
      views={card.views}
      likes={card.likes}
      thumbnail={card.thumbnail}
      thumbnailBlurHash={card.thumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      streamUrl={card.streamUrl}
      thumbnailLabel={tx("Edit {title}", { title: card.title })}
      onThumbnailClick={onOpen}
      onThumbnailIntent={onIntent}
      metaContent={
        <LibraryCardMeta source={source} createdAt={row.createdAt} />
      }
    />
  )
}

function formatDraftDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
