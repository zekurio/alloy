import * as React from "react"

import {
  clipDownloadUrl,
  type ClipEncodedVariant,
  clipHlsMasterUrl,
  type ClipStatus,
  clipStreamUrl,
  clipThumbnailUrl,
} from "@workspace/api"
import { VideoPlayer } from "@/components/video/video-player"
import {
  type HlsLevelSelection,
  mseHlsSupported,
  nativeHlsSupported,
} from "@/components/video/video-media-engine"
import { apiOrigin } from "@/lib/env"
import { formatBytes } from "@/lib/storage-format"

const AUTO_QUALITY_ID = "auto"
const SOURCE_QUALITY_ID = "source"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used for the source download option. */
  sourceContentType?: string | null
  thumbnail?: string | null
  variants?: ClipEncodedVariant[]
  status?: ClipStatus
  /** Whether the clip has HLS renditions available for adaptive playback. */
  hlsReady?: boolean
  encodeProgress?: number
  onPlayThreshold?: () => void
  onEnded?: () => void
  className?: string
  maxDisplayHeight?: string
  chromeSize?: "default" | "compact"
  autoPlay?: boolean
  enableHorizontalSeekShortcuts?: boolean
  /** Override the default 16:9 playback viewport. */
  aspectRatio?: number
}

const DEFAULT_ASPECT_RATIO = 16 / 9

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
  thumbnail,
  variants = [],
  status,
  hlsReady = false,
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
  const poster = thumbnail === undefined
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
            a.id.localeCompare(b.id),
        ),
    [variants],
  )

  const defaultEncodedId =
    sortedVariants.find((variant) => variant.isDefault)?.id ??
      sortedVariants[0]?.id ??
      null
  const sourcePlayable = canPlayNativeVideo(sourceContentType)

  // Adaptive streaming is offered when the clip was encoded with HLS and the
  // browser can play it (via hls.js or natively). A fatal HLS error flips the
  // player back to progressive for the rest of the session.
  const [hlsFailed, setHlsFailed] = React.useState(false)
  React.useEffect(() => setHlsFailed(false), [clipId])
  const hlsUsable = hlsReady && sortedVariants.length > 0 && !hlsFailed &&
    (mseHlsSupported() || nativeHlsSupported())

  const preferredQualityId = hlsUsable
    ? AUTO_QUALITY_ID
    : defaultEncodedId ?? (sourcePlayable ? SOURCE_QUALITY_ID : "")
  const [selectedQualityId, setSelectedQualityId] = React.useState(
    preferredQualityId,
  )

  React.useEffect(() => {
    setSelectedQualityId(preferredQualityId)
  }, [clipId, preferredQualityId])

  React.useEffect(() => {
    const stillAvailable =
      (selectedQualityId === AUTO_QUALITY_ID && hlsUsable) ||
      sortedVariants.some((variant) => variant.id === selectedQualityId) ||
      (selectedQualityId === SOURCE_QUALITY_ID && sourcePlayable)
    if (!stillAvailable) setSelectedQualityId(preferredQualityId)
  }, [
    hlsUsable,
    preferredQualityId,
    selectedQualityId,
    sortedVariants,
    sourcePlayable,
  ])

  const qualityOptions = [
    ...(sourceContentType
      ? [
        {
          id: SOURCE_QUALITY_ID,
          label: "Source",
          detail: sourcePlayable ? "Original upload" : "Download only",
          downloadUrl: clipDownloadUrl(clipId, "source", apiOrigin()),
          selectable: sourcePlayable,
        },
      ]
      : []),
    ...(hlsUsable
      ? [{ id: AUTO_QUALITY_ID, label: "Auto", detail: "Adaptive" }]
      : []),
    ...sortedVariants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      detail: variantDetail(variant),
      downloadUrl: clipDownloadUrl(clipId, variant.id, apiOrigin()),
    })),
  ]

  // Resolve the selection into a concrete playback source. HLS renditions and
  // "Auto" share one master URL (so switching among them never reloads); only
  // a level hint changes. "Source" — and any selection on a browser that can't
  // pin an HLS level — falls back to a progressive variant.
  const selectedVariant = sortedVariants.find((v) => v.id === selectedQualityId)
  let hlsMasterUrl: string | undefined
  let hlsLevelHeight: HlsLevelSelection = "auto"
  let progressiveVariantId = selectedQualityId
  if (hlsUsable && selectedQualityId !== SOURCE_QUALITY_ID) {
    if (selectedQualityId === AUTO_QUALITY_ID) {
      hlsMasterUrl = clipHlsMasterUrl(clipId, apiOrigin())
    } else if (selectedVariant && mseHlsSupported()) {
      hlsMasterUrl = clipHlsMasterUrl(clipId, apiOrigin())
      hlsLevelHeight = selectedVariant.height
    } else if (selectedVariant) {
      progressiveVariantId = selectedVariant.id
    }
  }
  const progressiveSrcId = progressiveVariantId === AUTO_QUALITY_ID
    ? (defaultEncodedId ?? SOURCE_QUALITY_ID)
    : progressiveVariantId

  const aspectRatio = aspectRatioProp ?? DEFAULT_ASPECT_RATIO

  if (!defaultEncodedId && !sourcePlayable) {
    const unavailable = status === "failed"
    return (
      <div
        className={className}
        style={{
          aspectRatio,
          maxHeight: maxDisplayHeight,
          width: maxDisplayHeight
            ? `min(100%, calc(${maxDisplayHeight} * ${aspectRatio}))`
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

  return (
    <VideoPlayer
      src={clipStreamUrl(clipId, progressiveSrcId, apiOrigin())}
      hlsMasterUrl={hlsMasterUrl}
      hlsLevelHeight={hlsLevelHeight}
      onHlsFatalError={() => setHlsFailed(true)}
      poster={poster}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      chromeSize={chromeSize}
      className={className}
      sourceIdentity={clipId}
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

export { ClipPlayer }
