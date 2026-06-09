import {
  clipDownloadUrl,
  clipHlsMasterUrl,
  type ClipPlaybackQuality,
  type ClipStatus,
  clipStreamUrl,
  clipThumbnailUrl,
} from "alloy-api"
import { MediaPlaceholder } from "alloy-ui/components/media-placeholder"
import { toast } from "alloy-ui/lib/toast"
import * as React from "react"

import { mseHlsSupported } from "@/components/video/video-media-engine"
import { VideoPlayer } from "@/components/video/video-player"
import {
  readLocalStorageItem,
  writeLocalStorageItem,
} from "@/lib/browser-storage"
import { apiOrigin } from "@/lib/env"
import { browserLiveCodecs } from "@/lib/live-codecs"
import { canPlaySource } from "@/lib/source-playback"
import { formatBytes } from "@/lib/storage-format"

const AUTO_QUALITY_ID = "auto"
const SOURCE_QUALITY_ID = "source"
const QUALITY_PREFERENCE_KEY = "alloy:clip-player-quality"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used for the source download option. */
  sourceContentType?: string | null
  sourceVideoCodec?: string | null
  sourceAudioCodec?: string | null
  thumbnail?: string | null
  thumbnailBlurHash?: string | null
  fallbackSeed?: string | number
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

function loadQualityPreference(): string | null {
  const value = readLocalStorageItem(QUALITY_PREFERENCE_KEY)?.trim()
  return value ? value : null
}

function saveQualityPreference(qualityId: string): void {
  writeLocalStorageItem(QUALITY_PREFERENCE_KEY, qualityId)
}

function resolveQualityPreference({
  defaultQualityId,
  preferredQualityId,
  sourceAvailable,
  qualities,
}: {
  defaultQualityId: string
  preferredQualityId: string | null
  sourceAvailable: boolean
  qualities: readonly ClipPlaybackQuality[]
}): string {
  const candidate = preferredQualityId ?? defaultQualityId
  if (candidate === AUTO_QUALITY_ID && sourceAvailable) return candidate
  if (candidate === SOURCE_QUALITY_ID && sourceAvailable) return candidate
  if (qualities.some((quality) => quality.id === candidate)) return candidate
  return defaultQualityId
}

function ClipPlayer({
  clipId,
  sourceContentType,
  sourceVideoCodec,
  sourceAudioCodec,
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
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
  const poster =
    thumbnail === undefined
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

  const defaultQualityId = sourceContentType ? AUTO_QUALITY_ID : ""
  const [qualityPreferenceId, setQualityPreferenceId] = React.useState<
    string | null
  >(() => loadQualityPreference())
  const [selectedQualityId, setSelectedQualityId] = React.useState(() =>
    resolveQualityPreference({
      defaultQualityId,
      preferredQualityId: qualityPreferenceId,
      sourceAvailable: Boolean(sourceContentType),
      qualities: sortedQualities,
    }),
  )

  React.useEffect(() => {
    setSelectedQualityId(
      resolveQualityPreference({
        defaultQualityId,
        preferredQualityId: qualityPreferenceId,
        sourceAvailable: Boolean(sourceContentType),
        qualities: sortedQualities,
      }),
    )
  }, [
    clipId,
    defaultQualityId,
    qualityPreferenceId,
    sortedQualities,
    sourceContentType,
  ])

  const handleSelectQuality = React.useCallback(
    (qualityId: string) => {
      setQualityPreferenceId(qualityId)
      saveQualityPreference(qualityId)
      setSelectedQualityId(
        resolveQualityPreference({
          defaultQualityId,
          preferredQualityId: qualityId,
          sourceAvailable: Boolean(sourceContentType),
          qualities: sortedQualities,
        }),
      )
    },
    [defaultQualityId, sortedQualities, sourceContentType],
  )

  const qualityOptions = [
    ...(sourceContentType
      ? [
          {
            id: SOURCE_QUALITY_ID,
            label: "Original",
            detail: sourcePlayable ? "Direct stream" : "Direct play attempt",
            downloadUrl: clipDownloadUrl(clipId, "source", apiOrigin()),
          },
          {
            id: AUTO_QUALITY_ID,
            label: "Auto",
            detail: "Original quality",
            selectionLabel: sortedQualities[0]?.label ?? "Original",
          },
        ]
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
  const progressiveSrcId =
    progressiveVariantId === AUTO_QUALITY_ID
      ? SOURCE_QUALITY_ID
      : progressiveVariantId
  const usingSourceAttempt = progressiveSrcId === SOURCE_QUALITY_ID
  const selectedLiveQuality =
    progressiveSrcId === SOURCE_QUALITY_ID
      ? null
      : (sortedQualities.find((quality) => quality.id === progressiveSrcId) ??
        null)
  const useHlsLevelSwitching = selectedLiveQuality ? mseHlsSupported() : false
  const hlsMasterUrl = selectedLiveQuality
    ? clipHlsMasterUrl(
        clipId,
        apiOrigin(),
        liveCodecs,
        useHlsLevelSwitching ? undefined : selectedLiveQuality.id,
      )
    : undefined
  const hlsLevelHeight =
    useHlsLevelSwitching && selectedLiveQuality
      ? {
          height: selectedLiveQuality.height,
          bitrate: selectedLiveQuality.bitrate,
        }
      : "auto"
  const handlePlaybackError = React.useCallback(
    (message: string) => {
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
    },
    [clipId, onPlaybackError, transcodeRetryQualityId, usingSourceAttempt],
  )

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
        <div className="relative grid size-full place-items-center overflow-hidden text-sm text-white/80">
          <MediaPlaceholder
            seed={fallbackSeed ?? clipId}
            blurHash={thumbnailBlurHash}
          />
          <span className="relative z-10">
            {unavailable
              ? "Playback unavailable."
              : "Preparing playback version..."}
          </span>
        </div>
      </div>
    )
  }

  return (
    <VideoPlayer
      src={clipStreamUrl(clipId, progressiveSrcId, apiOrigin(), liveCodecs)}
      hlsMasterUrl={hlsMasterUrl}
      hlsLevelHeight={hlsLevelHeight}
      poster={poster}
      posterBlurHash={thumbnailBlurHash}
      fallbackSeed={fallbackSeed ?? clipId}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      chromeSize={chromeSize}
      className={className}
      sourceIdentity={clipId}
      qualityOptions={qualityOptions}
      selectedQualityId={selectedQualityId}
      onSelectQuality={handleSelectQuality}
      onPlayThreshold={onPlayThreshold}
      onEnded={onEnded}
      onPlaybackError={handlePlaybackError}
      onHlsFatalError={handlePlaybackError}
      autoPlay={autoPlay}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
    />
  )
}

export { ClipPlayer }
