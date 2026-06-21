import { type ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { ClipCard } from "@alloy/ui/components/clip-card"
import { cn } from "@alloy/ui/lib/utils"
import { GlobeIcon, Link2Icon, LockIcon, MonitorIcon } from "lucide-react"
import * as React from "react"

import type { QueueItem } from "@/components/upload/upload-queue-types"
import { gameHref } from "@/lib/app-paths"
import { useCapturePoster } from "@/lib/capture-poster"
import { toClipCardData } from "@/lib/clip-format"
import { formatRelativeTime } from "@/lib/date-format"
import type { RecordingLibraryItem } from "@/lib/desktop"

import { useClipCardGameLink } from "../../clip/clip-card-links"
import { type LibraryItemView } from "./library-data"

export function LibraryCaptureCard({
  item,
  transfer,
  onOpen,
}: {
  item: LibraryItemView
  transfer?: QueueItem
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
  const cardThumbnail =
    transfer?.thumbUrl ?? transfer?.thumbFallbackUrl ?? thumbnail ?? undefined
  const cardThumbnailBlurHash = transfer?.thumbBlurHash ?? item.thumbBlurHash

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
      viewCount={0}
      likes="0"
      thumbnail={cardThumbnail}
      thumbnailBlurHash={cardThumbnailBlurHash}
      fallbackSeed={`${item.groupLabel}:${item.id}`}
      streamUrl={item.mediaUrl}
      thumbnailLabel={tx("Edit {title}", { title: item.title })}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryCardMeta
          source={source}
          createdAt={item.createdAt}
          transfer={transfer}
        />
      }
    />
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
  transfer,
}: {
  source: LibrarySource
  createdAt: string
  transfer?: QueueItem
}) {
  return (
    <>
      {transfer ? (
        transfer.status === "published" || transfer.status === "downloaded" ? (
          <LibrarySourceBadge source={source} />
        ) : (
          <LibraryTransferMeta transfer={transfer} />
        )
      ) : (
        <LibrarySourceBadge source={source} />
      )}
      <span className="shrink-0">{"·"}</span>
      <span className="truncate">{formatRelativeTime(createdAt)}</span>
    </>
  )
}

/** Grid card for a clip that already lives on the server. */
export function UploadedClipCard({
  row,
  localItem,
  transfer,
  onOpen,
  onIntent,
}: {
  row: ClipRow
  localItem?: RecordingLibraryItem | null
  transfer?: QueueItem
  onOpen: () => void
  onIntent?: () => void
}) {
  const card = React.useMemo(() => toClipCardData(row), [row])
  const source = librarySourceForPrivacy(row.privacy)
  const effectiveTransfer = transfer ?? transferFromClipRow(row)
  const localPoster = useCapturePoster({
    id: localItem?.id ?? "",
    mediaUrl: localItem?.mediaUrl ?? null,
    thumbnailUrl: localItem?.thumbnailUrl ?? null,
    durationMs: localItem?.durationMs ?? null,
    enabled: Boolean(localItem) && !card.thumbnail,
  })
  const localThumbnail = localPoster ?? localItem?.thumbnailUrl ?? undefined
  const localThumbnailBlurHash = localItem?.thumbBlurHash ?? null
  const thumbnail =
    effectiveTransfer?.thumbUrl ??
    effectiveTransfer?.thumbFallbackUrl ??
    card.thumbnail
  const thumbnailBlurHash =
    effectiveTransfer?.thumbBlurHash ?? card.thumbnailBlurHash
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
      viewCount={card.viewCount}
      likes={card.likes}
      thumbnail={thumbnail}
      thumbnailFallback={localThumbnail}
      thumbnailBlurHash={thumbnailBlurHash}
      thumbnailFallbackBlurHash={localThumbnailBlurHash}
      fallbackSeed={card.fallbackSeed}
      streamUrl={card.streamUrl}
      thumbnailLabel={tx("Edit {title}", { title: card.title })}
      onThumbnailClick={onOpen}
      onThumbnailIntent={onIntent}
      metaContent={
        <LibraryCardMeta
          source={source}
          createdAt={row.createdAt}
          transfer={effectiveTransfer}
        />
      }
    />
  )
}

function transferFromClipRow(row: ClipRow): QueueItem | undefined {
  if (row.status === "ready") return undefined

  const failed = row.status === "failed"
  const processing = row.status === "processing"
  const progress = processing
    ? Math.max(0, Math.min(99, Math.floor(row.encodeProgress)))
    : 0

  return {
    id: row.id,
    title: row.title,
    kind: "upload",
    status: failed ? "failed" : processing ? "uploading" : "queued",
    progress,
    detail: failed
      ? (row.failureReason ?? tx("Upload failed"))
      : processing
        ? "Finalizing…"
        : tx("Local"),
    hue: 0,
  }
}

function LibraryTransferMeta({ transfer }: { transfer: QueueItem }) {
  const meta = transferMeta(transfer)
  if (!meta) return null

  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap",
        meta.tone,
      )}
      title={transfer.detail ? `${meta.label}: ${transfer.detail}` : meta.label}
      aria-label={
        transfer.detail ? `${meta.label}: ${transfer.detail}` : meta.label
      }
    >
      <span>{meta.label}</span>
      {meta.showPercent ? (
        <span className="tabular-nums">{meta.progress}%</span>
      ) : null}
    </span>
  )
}

function transferMeta(transfer: QueueItem): {
  label: string
  progress: number
  showPercent: boolean
  tone: string
} | null {
  if (transfer.status === "published" || transfer.status === "downloaded") {
    return null
  }

  if (transfer.status === "failed") {
    return {
      label: tx("Failed"),
      progress: 0,
      showPercent: false,
      tone: "text-destructive",
    }
  }

  if (transfer.status === "preparing") {
    return {
      label: tx("Preparing..."),
      progress: 0,
      showPercent: false,
      tone: "text-accent",
    }
  }

  if (transfer.status === "queued" || transfer.status === "paused") {
    return {
      label: tx("Local"),
      progress: 0,
      showPercent: false,
      tone: "text-foreground-muted",
    }
  }

  const progress = Math.max(0, Math.min(99, transfer.progress))
  return {
    label: transfer.detail.toLowerCase().includes("finalizing")
      ? tx("Processing")
      : transfer.kind === "download"
        ? tx("Download")
        : tx("Upload"),
    progress,
    showPercent: transfer.showProgress !== false,
    tone: "text-accent",
  }
}
