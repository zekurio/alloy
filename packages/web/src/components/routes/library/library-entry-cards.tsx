import type { ClipRow } from "alloy-api"
import { Button } from "alloy-ui/components/button"
import { ClipCard } from "alloy-ui/components/clip-card"
import { CloudIcon, FolderOpenIcon, MonitorIcon } from "lucide-react"
import * as React from "react"

import { toClipCardData } from "@/lib/clip-format"
import { formatRelativeTime } from "@/lib/date-format"
import type { RecordingLibraryProjectDraft } from "@/lib/desktop"

import { formatLibraryBytes, type LibraryItemView } from "./library-data"

export function LibraryCaptureCard({
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
export function UploadedClipCard({
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

function formatDraftDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
