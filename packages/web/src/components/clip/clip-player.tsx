import {
  type ClipRenditionRef,
  clipRenditionFileUrl,
  type ClipStatus,
  clipMasterPlaylistUrl,
  clipStreamUrl,
  clipThumbnailUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useMemo, useState } from "react"

import type { HlsPlayback } from "@/components/video/video-media-engine"
import { VideoPlayer } from "@/components/video/video-player"
import { apiOrigin } from "@/lib/env"

const AUTO_QUALITY_ID = "auto"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source; absent while the clip is processing. */
  sourceContentType?: string | null
  /** Cache-busting version of the published source; changes on republish. */
  sourceVersion?: string | null
  /** Committed quality tiers, highest first. Empty for pre-backfill clips. */
  renditions?: ClipRenditionRef[]
  /** Cache-busting version of the HLS playlist set. */
  playbackVersion?: string | null
  thumbnail?: string | null
  thumbnailBlurHash?: string | null
  fallbackSeed?: string | number
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

function ClipPlayer({
  clipId,
  sourceContentType,
  sourceVersion,
  renditions = [],
  playbackVersion,
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
  status,
  encodeProgress = 0,
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

  const [selectedQualityId, setSelectedQualityId] = useState(AUTO_QUALITY_ID)
  const selectedHeight =
    selectedQualityId === AUTO_QUALITY_ID ? null : Number(selectedQualityId)

  const hlsPlayback = useMemo<HlsPlayback | null>(() => {
    if (renditions.length === 0) return null
    return {
      masterUrl: clipMasterPlaylistUrl(
        clipId,
        apiOrigin(),
        playbackVersion ?? undefined,
      ),
      selectedHeight,
      renditionUrls: Object.fromEntries(
        renditions.map((rendition) => [
          rendition.height,
          clipRenditionFileUrl(
            clipId,
            rendition.height,
            apiOrigin(),
            rendition.version,
          ),
        ]),
      ),
    }
  }, [clipId, playbackVersion, renditions, selectedHeight])

  // Progressive fallback: the pinned tier's file when one is selected,
  // otherwise the stream endpoint (top rendition, or the source for clips the
  // backfill hasn't reached).
  const pinned =
    selectedHeight !== null
      ? renditions.find((rendition) => rendition.height === selectedHeight)
      : undefined
  const fallbackSrc = pinned
    ? clipRenditionFileUrl(clipId, pinned.height, apiOrigin(), pinned.version)
    : clipStreamUrl(clipId, apiOrigin(), sourceVersion ?? undefined)

  const qualityOptions = useMemo(() => {
    if (renditions.length === 0) return []
    return [
      { id: AUTO_QUALITY_ID, label: t("Auto") },
      ...renditions.map((rendition) => ({
        id: String(rendition.height),
        label: `${rendition.height}p`,
        detail: rendition.fps > 30 ? `${rendition.fps} fps` : undefined,
      })),
    ]
  }, [renditions])

  const handlePlaybackError = useCallback(
    (message: string) => {
      if (onPlaybackError) {
        onPlaybackError(message)
        return
      }
      toast.error(message, {
        id: `clip-playback-${clipId}`,
        duration: 10_000,
      })
    },
    [clipId, onPlaybackError],
  )

  const aspectRatio = aspectRatioProp ?? DEFAULT_ASPECT_RATIO

  if (!sourceContentType && renditions.length === 0) {
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
              ? t("Playback unavailable.")
              : encodeProgress > 0
                ? t("Preparing playback... {percent}%", {
                    percent: encodeProgress,
                  })
                : t("Preparing playback version...")}
          </span>
        </div>
      </div>
    )
  }

  return (
    <VideoPlayer
      src={fallbackSrc}
      hlsPlayback={hlsPlayback}
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
