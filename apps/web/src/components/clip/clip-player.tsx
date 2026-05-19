import * as React from "react"

import {
  clipDownloadUrl,
  clipStreamUrl,
  clipThumbnailUrl,
  type ClipEncodedVariant,
  type ClipStatus,
} from "@workspace/api"
import { VideoPlayer } from "@/components/video/video-player"
import { apiOrigin } from "@/lib/env"
import { formatBytes } from "@/lib/storage-format"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used for the source download option. */
  sourceContentType?: string | null
  width?: number | null
  height?: number | null
  thumbnail?: string | null
  variants?: ClipEncodedVariant[]
  status?: ClipStatus
  encodeProgress?: number
  onPlayThreshold?: () => void
  onEnded?: () => void
  className?: string
  maxDisplayHeight?: string
  chromeSize?: "default" | "compact"
  autoPlay?: boolean
  enableHorizontalSeekShortcuts?: boolean
  /** Override the aspect ratio derived from source dimensions. */
  aspectRatio?: number
}

const DEFAULT_ASPECT_RATIO = 16 / 9

function aspectRatioFromDimensions(
  width: number | null | undefined,
  height: number | null | undefined
): number {
  if (!width || !height || width <= 0 || height <= 0) {
    return DEFAULT_ASPECT_RATIO
  }
  return width / height
}

function canPlayNativeVideo(contentType: string | null | undefined): boolean {
  if (!contentType || typeof document === "undefined") return false
  const video = document.createElement("video")
  return video.canPlayType(contentType) !== ""
}

function variantDetail(variant: ClipEncodedVariant): string {
  const parts = [
    variant.settings?.codec?.toUpperCase(),
    `${variant.width}x${variant.height}`,
    formatBytes(variant.sizeBytes),
  ].filter(Boolean)
  return parts.join(" · ")
}

function ClipPlayer({
  clipId,
  sourceContentType,
  width,
  height,
  thumbnail,
  variants = [],
  status,
  encodeProgress: _encodeProgress = 0,
  onPlayThreshold,
  onEnded,
  className,
  maxDisplayHeight,
  chromeSize,
  autoPlay,
  enableHorizontalSeekShortcuts,
  aspectRatio: aspectRatioProp,
}: ClipPlayerProps) {
  const poster =
    thumbnail === undefined
      ? clipThumbnailUrl(clipId, apiOrigin())
      : (thumbnail ?? undefined)
  const sortedVariants = React.useMemo(
    () =>
      variants
        .slice()
        .sort(
          (a, b) =>
            b.height - a.height ||
            a.label.localeCompare(b.label) ||
            a.id.localeCompare(b.id)
        ),
    [variants]
  )

  const defaultEncodedId =
    sortedVariants.find((variant) => variant.isDefault)?.id ??
    sortedVariants[0]?.id ??
    null
  const sourcePlayable = canPlayNativeVideo(sourceContentType)
  const preferredQualityId =
    defaultEncodedId ?? (sourcePlayable ? "source" : "")
  const [selectedQualityId, setSelectedQualityId] =
    React.useState(preferredQualityId)

  React.useEffect(() => {
    setSelectedQualityId(preferredQualityId)
  }, [clipId, preferredQualityId])

  React.useEffect(() => {
    if (selectedQualityId === defaultEncodedId) return
    const stillAvailable =
      sortedVariants.some((variant) => variant.id === selectedQualityId) ||
      (selectedQualityId === "source" && sourcePlayable)
    if (!stillAvailable) setSelectedQualityId(preferredQualityId)
  }, [
    defaultEncodedId,
    preferredQualityId,
    selectedQualityId,
    sortedVariants,
    sourcePlayable,
  ])

  const qualityOptions = [
    ...(sourceContentType
      ? [
          {
            id: "source",
            label: "Source",
            detail: sourcePlayable ? "Original upload" : "Download only",
            downloadUrl: clipDownloadUrl(clipId, "source", apiOrigin()),
            selectable: sourcePlayable,
          },
        ]
      : []),
    ...sortedVariants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      detail: variantDetail(variant),
      downloadUrl: clipDownloadUrl(clipId, variant.id, apiOrigin()),
    })),
  ]
  const sourceAspectRatio =
    aspectRatioProp ?? aspectRatioFromDimensions(width, height)

  if (!defaultEncodedId && !sourcePlayable) {
    const unavailable = status === "failed"
    return (
      <div
        className={className}
        style={{
          aspectRatio: sourceAspectRatio,
          maxHeight: maxDisplayHeight,
          width: maxDisplayHeight
            ? `min(100%, calc(${maxDisplayHeight} * ${sourceAspectRatio}))`
            : undefined,
        }}
      >
        <div className="grid size-full place-items-center bg-[oklch(12%_0.01_250)] text-sm text-white/70">
          {unavailable
            ? "Playback unavailable."
            : "Preparing playback version..."}
        </div>
      </div>
    )
  }

  const selectedVariant =
    selectedQualityId === "source"
      ? null
      : (sortedVariants.find((variant) => variant.id === selectedQualityId) ??
        null)
  const aspectRatio =
    aspectRatioProp ??
    aspectRatioFromDimensions(
      selectedVariant?.width ?? width,
      selectedVariant?.height ?? height
    )

  return (
    <VideoPlayer
      src={clipStreamUrl(clipId, selectedQualityId, apiOrigin())}
      poster={poster}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      chromeSize={chromeSize}
      className={className}
      sourceIdentity={`${clipId}:${selectedQualityId}`}
      qualityOptions={qualityOptions}
      selectedQualityId={selectedQualityId}
      onSelectQuality={setSelectedQualityId}
      onPlayThreshold={onPlayThreshold}
      onEnded={onEnded}
      autoPlay={autoPlay}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
    />
  )
}

export { ClipPlayer, type ClipPlayerProps }
