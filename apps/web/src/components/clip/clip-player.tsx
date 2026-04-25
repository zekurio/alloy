import * as React from "react"

import {
  clipDownloadUrl,
  clipStreamUrl,
  clipThumbnailUrl,
  type ClipEncodedVariant,
  type ClipStatus,
} from "@workspace/api"
import { VideoPlayer } from "@/components/video/video-player"

interface ClipPlayerProps {
  /** Real clip id — drives both the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used to decide if native playback can start on source quality. */
  sourceContentType?: string
  width?: number | null
  height?: number | null
  thumbnail?: string | null
  variants?: ClipEncodedVariant[]
  status?: ClipStatus
  encodeProgress?: number
  onPlayThreshold?: () => void
  onEnded?: () => void
  className?: string
  autoPlay?: boolean
  autoAdvance?: boolean
  onAutoAdvanceChange?: (next: boolean) => void
  /** Override the aspect ratio derived from source dimensions. */
  aspectRatio?: number
}

const FALLBACK_ENCODED_OPTION = {
  id: "encoded",
  label: "Encoded",
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

function canPlayNativeVideo(contentType: string | undefined): boolean {
  if (!contentType || typeof document === "undefined") return false
  const video = document.createElement("video")
  return video.canPlayType(contentType) !== ""
}

function ClipPlayer({
  clipId,
  sourceContentType,
  width,
  height,
  thumbnail,
  variants = [],
  status,
  encodeProgress = 0,
  onPlayThreshold,
  onEnded,
  className,
  autoPlay,
  autoAdvance,
  onAutoAdvanceChange,
  aspectRatio: aspectRatioProp,
}: ClipPlayerProps) {
  const poster =
    thumbnail === undefined
      ? clipThumbnailUrl(clipId)
      : (thumbnail ?? undefined)
  const sortedVariants = React.useMemo(
    () =>
      variants
        .filter((variant) => variant.id !== "source")
        .sort((a, b) => b.height - a.height),
    [variants]
  )

  const hasLegacyEncodedFallback =
    status === "ready" && encodeProgress >= 100 && sortedVariants.length === 0
  const encodedQualityOptions =
    sortedVariants.length > 0
      ? sortedVariants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          downloadUrl: clipDownloadUrl(clipId, variant.id),
        }))
      : hasLegacyEncodedFallback
        ? [
            {
              ...FALLBACK_ENCODED_OPTION,
              downloadUrl: clipDownloadUrl(clipId, "encoded"),
            },
          ]
        : []
  const defaultEncodedId =
    sortedVariants.find((variant) => variant.isDefault)?.id ??
    sortedVariants[0]?.id ??
    (hasLegacyEncodedFallback ? FALLBACK_ENCODED_OPTION.id : null)

  const [sourcePlayable, setSourcePlayable] = React.useState(() =>
    canPlayNativeVideo(sourceContentType)
  )
  React.useEffect(() => {
    setSourcePlayable(canPlayNativeVideo(sourceContentType))
  }, [sourceContentType])

  const preferredQualityId = sourcePlayable
    ? "source"
    : (defaultEncodedId ?? "source")
  const [selectedQualityId, setSelectedQualityId] =
    React.useState(preferredQualityId)

  React.useEffect(() => {
    setSelectedQualityId(preferredQualityId)
  }, [clipId, preferredQualityId])

  React.useEffect(() => {
    if (
      selectedQualityId === "source" ||
      selectedQualityId === defaultEncodedId
    )
      return
    const stillAvailable = sortedVariants.some(
      (variant) => variant.id === selectedQualityId
    )
    if (!stillAvailable) setSelectedQualityId(preferredQualityId)
  }, [defaultEncodedId, preferredQualityId, selectedQualityId, sortedVariants])

  const qualityOptions = [
    ...(sourcePlayable
      ? [
          {
            id: "source",
            label: "Source",
            downloadUrl: clipDownloadUrl(clipId, "source"),
          },
        ]
      : []),
    ...encodedQualityOptions,
  ]

  if (!sourcePlayable && !defaultEncodedId) {
    return (
      <div
        className={className}
        style={{ aspectRatio: aspectRatioProp ?? DEFAULT_ASPECT_RATIO }}
      >
        <div className="grid size-full place-items-center bg-black text-sm text-white/70">
          Preparing playback version…
        </div>
      </div>
    )
  }

  const src = clipStreamUrl(clipId, selectedQualityId)
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
      src={src}
      poster={poster}
      aspectRatio={aspectRatio}
      className={className}
      sourceIdentity={`${clipId}:${selectedQualityId}`}
      qualityOptions={qualityOptions}
      selectedQualityId={selectedQualityId}
      onSelectQuality={setSelectedQualityId}
      onPlaybackError={() => {
        if (selectedQualityId === "source") {
          setSourcePlayable(false)
          if (defaultEncodedId) setSelectedQualityId(defaultEncodedId)
        }
      }}
      onPlayThreshold={onPlayThreshold}
      onEnded={onEnded}
      autoPlay={autoPlay}
      autoAdvance={autoAdvance}
      onAutoAdvanceChange={onAutoAdvanceChange}
    />
  )
}

export { ClipPlayer, type ClipPlayerProps }
