import * as React from "react"

import {
  clipDownloadUrl,
  type ClipPlaybackQuality,
  type ClipStatus,
  clipStreamUrl,
  clipThumbnailUrl,
} from "@workspace/api"
import { VideoPlayer } from "@/components/video/video-player"
import { apiOrigin } from "@/lib/env"
import { browserLiveCodecs } from "@/lib/live-codecs"
import { canPlaySource } from "@/lib/source-playback"
import { formatBytes } from "@/lib/storage-format"
import { toast } from "@workspace/ui/lib/toast"

const AUTO_QUALITY_ID = "auto"
const SOURCE_QUALITY_ID = "source"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used for the source download option. */
  sourceContentType?: string | null
  sourceVideoCodec?: string | null
  sourceAudioCodec?: string | null
  thumbnail?: string | null
  playbackQualities?: ClipPlaybackQuality[]
  status?: ClipStatus
  encodeProgress?: number
  onPlayThreshold?: () => void
  onEnded?: () => void
  onPlaybackError?: (message: string) => void
  className?: string
  maxDisplayHeight?: string
  chromeSize?: "default" | "compact"
  autoPlay?: boolean
  enableHorizontalSeekShortcuts?: boolean
  /** Override the default 16:9 playback viewport. */
  aspectRatio?: number
}

const DEFAULT_ASPECT_RATIO = 16 / 9

function qualityDetail(quality: ClipPlaybackQuality): string {
  const dimensions = quality.width
    ? `${quality.width}x${quality.height}`
    : `${quality.height}p`
  return `${dimensions} · ${formatBytes(Math.round(quality.bitrate / 8))}/s`
}

function ClipPlayer({
  clipId,
  sourceContentType,
  sourceVideoCodec,
  sourceAudioCodec,
  thumbnail,
  playbackQualities = [],
  status,
  encodeProgress: _encodeProgress = 0,
  onPlayThreshold,
  onEnded,
  onPlaybackError,
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
  const sortedQualities = React.useMemo(
    () =>
      playbackQualities
        .slice()
        .sort(
          (a, b) =>
            b.bitrate - a.bitrate ||
            b.height - a.height ||
            a.id.localeCompare(b.id),
        ),
    [playbackQualities],
  )

  const sourcePlayable = canPlaySource(sourceContentType, {
    videoCodec: sourceVideoCodec,
    audioCodec: sourceAudioCodec,
  })
  const liveCodecs = React.useMemo(() => browserLiveCodecs(), [])
  const transcodeRetryQualityId = sortedQualities[0]?.id ?? null

  const preferredQualityId = sourceContentType ? AUTO_QUALITY_ID : ""
  const [selectedQualityId, setSelectedQualityId] = React.useState(
    preferredQualityId,
  )

  React.useEffect(() => {
    setSelectedQualityId(preferredQualityId)
  }, [clipId, preferredQualityId])

  React.useEffect(() => {
    const stillAvailable =
      (selectedQualityId === AUTO_QUALITY_ID && Boolean(sourceContentType)) ||
      sortedQualities.some((quality) => quality.id === selectedQualityId) ||
      (selectedQualityId === SOURCE_QUALITY_ID && Boolean(sourceContentType))
    if (!stillAvailable) setSelectedQualityId(preferredQualityId)
  }, [
    preferredQualityId,
    selectedQualityId,
    sortedQualities,
    sourceContentType,
    sourcePlayable,
  ])

  const qualityOptions = [
    ...(sourceContentType
      ? [{
        id: SOURCE_QUALITY_ID,
        label: "Original",
        detail: sourcePlayable ? "Direct stream" : "Direct play attempt",
        downloadUrl: clipDownloadUrl(clipId, "source", apiOrigin()),
      }, {
        id: AUTO_QUALITY_ID,
        label: "Auto",
        detail: "Original quality",
        selectionLabel: sortedQualities[0]?.label ?? "Original",
      }]
      : []),
    ...sortedQualities.map((quality) => ({
      id: quality.id,
      label: quality.label,
      detail: qualityDetail(quality),
    })),
  ]

  // Auto is the original object. Fixed bitrate IDs are transient live
  // transcodes; they do not correspond to stored clip assets.
  const progressiveVariantId = selectedQualityId || AUTO_QUALITY_ID
  const progressiveSrcId = progressiveVariantId === AUTO_QUALITY_ID
    ? SOURCE_QUALITY_ID
    : progressiveVariantId
  const usingSourceAttempt = progressiveSrcId === SOURCE_QUALITY_ID
  const handlePlaybackError = React.useCallback((message: string) => {
    if (usingSourceAttempt && transcodeRetryQualityId) {
      setSelectedQualityId(transcodeRetryQualityId)
      return
    }
    if (onPlaybackError) {
      onPlaybackError(message)
      return
    }
    toast.error(message, {
      id: `clip-playback-${clipId}`,
      duration: 10_000,
    })
  }, [clipId, onPlaybackError, transcodeRetryQualityId, usingSourceAttempt])

  const aspectRatio = aspectRatioProp ?? DEFAULT_ASPECT_RATIO

  if (!sourceContentType) {
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
      src={clipStreamUrl(clipId, progressiveSrcId, apiOrigin(), liveCodecs)}
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
      onPlaybackError={handlePlaybackError}
      autoPlay={autoPlay}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
    />
  )
}

export { ClipPlayer }
