import {
  type ClipRenditionRef,
  clipRenditionFileUrl,
  type ClipStatus,
  clipStreamUrl,
  clipThumbnailUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useMemo, useState } from "react"

import { VideoPlayer } from "@/components/video/video-player"
import { clipHlsPlayback } from "@/lib/clip-hls"
import { apiOrigin } from "@/lib/env"

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

  // Poster shown while the clip has no playable media yet (processing/failed).
  const pendingPoster = useImageLoaded(poster)

  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(
    null,
  )
  const effectiveQualityId = renditions.some(
    (rendition) => rendition.name === selectedQualityId,
  )
    ? selectedQualityId
    : (renditions[0]?.name ?? null)

  // Progressive fallback: the pinned tier's file when one is selected,
  // otherwise the stream endpoint (top rendition, or the source for clips the
  // backfill hasn't reached).
  const pinned = renditions.find(
    (rendition) => rendition.name === effectiveQualityId,
  )

  const hlsPlayback = useMemo(
    () =>
      clipHlsPlayback(
        clipId,
        renditions,
        playbackVersion,
        pinned
          ? { name: pinned.name, height: pinned.height, fps: pinned.fps }
          : null,
      ),
    [clipId, playbackVersion, renditions, pinned],
  )

  const fallbackSrc = pinned
    ? clipRenditionFileUrl(clipId, pinned.name, apiOrigin(), pinned.version)
    : clipStreamUrl(clipId, apiOrigin(), sourceVersion ?? undefined)

  const qualityOptions = useMemo(() => {
    if (renditions.length === 0) return []
    return renditions.map((rendition) => ({
      id: rendition.name,
      label: renditionQualityLabel(rendition, renditions),
    }))
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
            aspectRatio={aspectRatio}
            className={cn(
              "transition-opacity duration-200 ease-out",
              pendingPoster.loaded ? "opacity-0" : "opacity-100",
            )}
          />
          {poster ? (
            <img
              ref={pendingPoster.ref}
              src={poster}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-contain"
              decoding="async"
              onLoad={pendingPoster.markLoaded}
            />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-black/40" />
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
      selectedQualityId={effectiveQualityId ?? undefined}
      onSelectQuality={setSelectedQualityId}
      onPlayThreshold={onPlayThreshold}
      onEnded={onEnded}
      onPlaybackError={handlePlaybackError}
      autoPlay={autoPlay}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
    />
  )
}

function renditionQualityLabel(
  rendition: ClipRenditionRef,
  renditions: readonly ClipRenditionRef[],
): string {
  const label = `${rendition.height}p${rendition.fps}fps`
  if (!hasResolutionFpsTie(rendition, renditions)) return label
  const codec = renditionCodecLabel(rendition.codecs)
  return codec ? `${label} (${codec})` : label
}

function hasResolutionFpsTie(
  rendition: ClipRenditionRef,
  renditions: readonly ClipRenditionRef[],
): boolean {
  return renditions.some(
    (candidate) =>
      candidate.name !== rendition.name &&
      candidate.height === rendition.height &&
      candidate.fps === rendition.fps,
  )
}

function renditionCodecLabel(codecs: string): string | null {
  const videoCodec = codecs
    .split(",")
    .map((codec) => codec.trim().toLowerCase())
    .find((codec) => !codec.startsWith("mp4a."))
  if (!videoCodec) return null
  if (videoCodec.startsWith("avc1.")) return "H.264"
  if (videoCodec.startsWith("hvc1.") || videoCodec.startsWith("hev1.")) {
    return "HEVC"
  }
  if (videoCodec.startsWith("av01.")) return "AV1"
  return videoCodec.toUpperCase()
}

export { ClipPlayer }
