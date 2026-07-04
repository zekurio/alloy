import { type ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ClipCard } from "@alloy/ui/components/clip-card"
import {
  GlobeIcon,
  Link2Icon,
  LockIcon,
  MonitorIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useMemo } from "react"
import type { ComponentType } from "react"

import {
  encodeStageLabel,
  QueueProgressBar,
} from "@/components/upload/queue-progress"
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
      thumbnailLabel={t("Edit {title}", { title: item.title })}
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
    icon: ComponentType<{ className?: string }>
    label: string
  }
> = {
  local: { icon: MonitorIcon, label: t("Local") },
  "link-disabled": { icon: LockIcon, label: t("Private") },
  "link-only": { icon: Link2Icon, label: t("Unlisted") },
  "on-profile": { icon: GlobeIcon, label: t("Public") },
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
  const card = useMemo(() => toClipCardData(row), [row])
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
  const gameId = card.gameRef?.slug ?? null
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
      thumbnailLabel={t("Edit {title}", { title: card.title })}
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
  // Uncapped: the server self-caps encodeProgress at 99 until the clip is
  // ready, so the card only ever hits 100 once playback is committed.
  const progress = processing
    ? Math.max(0, Math.min(100, Math.floor(row.encodeProgress)))
    : 0

  return {
    id: row.id,
    title: row.title,
    kind: "upload",
    status: failed ? "failed" : processing ? "uploading" : "queued",
    progress,
    showProgress: processing,
    indeterminate: processing ? progress <= 0 : true,
    label: failed
      ? t("Failed")
      : processing
        ? encodeStageLabel({
            stage: row.encodeStage,
            tier: row.encodeTier,
            tierIndex: row.encodeTierIndex,
            tierCount: row.encodeTierCount,
          })
        : t("Local"),
    detail: failed ? (row.failureReason ?? t("Upload failed")) : "",
    hue: 0,
  }
}

/**
 * Compact transfer state for the card meta line: a stage label plus a thin
 * progress bar (no numeric percent — the bar carries it in this tight space).
 */
function LibraryTransferMeta({ transfer }: { transfer: QueueItem }) {
  if (transfer.status === "published" || transfer.status === "downloaded") {
    return null
  }

  if (transfer.status === "failed") {
    return (
      <span
        className="text-destructive inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
        title={transfer.detail || t("Failed")}
      >
        {t("Failed")}
        {transfer.onRetry ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Retry")}
            title={t("Retry")}
            onClick={(event) => {
              event.stopPropagation()
              transfer.onRetry?.()
            }}
            className="text-destructive hover:text-foreground size-6"
          >
            <RefreshCwIcon />
          </Button>
        ) : null}
      </span>
    )
  }

  const idle =
    transfer.status === "queued" ||
    transfer.status === "paused" ||
    transfer.status === "preparing"
  if (idle) {
    return (
      <span className="text-foreground-muted shrink-0 whitespace-nowrap">
        {transfer.label ?? t("Local")}
      </span>
    )
  }

  const title = transfer.detail
    ? `${transfer.label}: ${transfer.detail}`
    : transfer.label
  return (
    <span
      className="text-accent inline-flex min-w-0 items-center gap-1.5"
      title={title}
      aria-label={title}
    >
      <span className="shrink-0 whitespace-nowrap">{transfer.label}</span>
      <QueueProgressBar
        value={transfer.progress}
        indeterminate={transfer.indeterminate}
        className="w-14 shrink-0"
      />
    </span>
  )
}
