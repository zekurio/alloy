import { type ClipRow } from "@alloy/api"
import { contentTypeForFile } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { ClipCard } from "@alloy/ui/components/clip-card"
import { GlobeIcon, Link2Icon, LockIcon, MonitorIcon } from "lucide-react"
import { useMemo } from "react"
import type { ComponentType } from "react"

import type { QueueItem } from "@/components/upload/upload-queue-types"
import { gameHref } from "@/lib/app-paths"
import { useCapturePoster } from "@/lib/capture-poster"
import { toClipCardData } from "@/lib/clip-format"
import { formatRelativeTime } from "@/lib/date-format"
import { desktopCachedAssetUrl, type RecordingLibraryItem } from "@/lib/desktop"
import {
  localClipPlaybackWindow,
  mediaWindowSeconds,
  versionedLocalMediaUrl,
} from "@/lib/local-clip-media"
import { canPlaySource } from "@/lib/media-capability"

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
  const renderGameLink = useClipCardGameLink(item.gameSlug)
  const gameUrl = item.gameSlug ? gameHref(item.gameSlug) : null
  const cardThumbnail =
    transfer?.thumbUrl ?? transfer?.thumbFallbackUrl ?? thumbnail ?? undefined
  const cardThumbnailBlurHash = transfer?.thumbBlurHash ?? item.thumbBlurHash

  return (
    <ClipCard
      title={item.title}
      titleContent={<LibraryCardTitle title={item.title} />}
      author=""
      game={item.displayGameName}
      gameIcon={desktopCachedAssetUrl(item.displayGameIconUrl)}
      gameHref={gameUrl}
      renderGameLink={renderGameLink}
      views="0"
      viewCount={0}
      likes="0"
      thumbnail={cardThumbnail}
      thumbnailBlurHash={cardThumbnailBlurHash}
      fallbackSeed={`${item.groupLabel}:${item.id}`}
      streamUrl={versionedLocalMediaUrl(item)}
      streamRange={
        item.trimStartMs !== null && item.trimEndMs !== null
          ? {
              start: item.trimStartMs / 1_000,
              end: item.trimEndMs / 1_000,
            }
          : undefined
      }
      thumbnailLabel={t("Edit {title}", { title: item.title })}
      onThumbnailClick={onOpen}
      metaContent={
        <LibraryCardMeta source={source} createdAt={item.createdAt} />
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

const SOURCE_META = {
  local: { icon: MonitorIcon, label: t("Local") },
  "link-disabled": { icon: LockIcon, label: t("Private") },
  "link-only": { icon: Link2Icon, label: t("Unlisted") },
  "on-profile": { icon: GlobeIcon, label: t("Public") },
} satisfies Record<
  LibrarySource,
  { icon: ComponentType<{ className?: string }>; label: string }
>

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
  const effectiveTransfer = transfer
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
  const localPreviewWindow = localItem
    ? localClipPlaybackWindow(localItem, row)
    : null
  const localPreview = Boolean(
    localItem &&
    localPreviewWindow &&
    canPlaySource(contentTypeForFile(localItem.fileName), ""),
  )
  return (
    <ClipCard
      title={card.title}
      titleContent={<LibraryCardTitle title={card.title} />}
      author=""
      game={card.game}
      gameIcon={desktopCachedAssetUrl(card.gameRef?.iconUrl ?? null)}
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
      streamUrl={
        localPreview && localItem
          ? versionedLocalMediaUrl(localItem)
          : card.streamUrl
      }
      streamRange={
        localPreview && localPreviewWindow
          ? mediaWindowSeconds(localPreviewWindow)
          : undefined
      }
      thumbnailLabel={t("Edit {title}", { title: card.title })}
      onThumbnailClick={onOpen}
      onThumbnailIntent={onIntent}
      metaContent={
        <LibraryCardMeta source={source} createdAt={row.createdAt} />
      }
    />
  )
}
