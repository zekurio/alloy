import {
  type ClipRenditionRef,
  clipRenditionFileUrl,
  type ClipStatus,
  clipSourceFileUrl,
  clipThumbnailUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useMemo, useState } from "react"

import type {
  RenditionPlayback,
  RenditionSource,
} from "@/components/video/video-media-engine"
import { VideoPlayer } from "@/components/video/video-player"
import { apiOrigin } from "@/lib/env"
import { canPlaySource } from "@/lib/media-capability"

// Rendition names are resolution tiers ("1080p60"), so "source" never collides.
const SOURCE_QUALITY_ID = "source"

interface ClipPlayerProps {
  /** Real clip id: drives the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source; absent while the clip is processing. */
  sourceContentType?: string | null
  /** RFC 6381 codecs of the source; null for clips probed before the column. */
  sourceCodecs?: string | null
  /** Cache-busting version of the published source; changes on republish. */
  sourceVersion?: string | null
  /** Whether the source endpoint serves a derived cut (always MP4). */
  trimmed?: boolean
  /** Committed quality tiers, highest first. Empty for pre-backfill clips. */
  renditions?: ClipRenditionRef[]
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
  sourceCodecs,
  sourceVersion,
  trimmed = false,
  renditions = [],
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

  // Selection is scoped to the clip: the viewers reuse one ClipPlayer across
  // navigation, and a manual pin — or an automatic fallback — on one clip
  // must not carry over to the next. `pinned` marks a menu choice, which
  // opts that clip out of stall-based downgrades.
  const [selection, setSelection] = useState({
    clipId,
    name: SOURCE_QUALITY_ID,
    pinned: false,
  })
  const scopedSelection =
    selection.clipId === clipId
      ? selection
      : { clipId, name: SOURCE_QUALITY_ID, pinned: false }
  const selectedQualityId = scopedSelection.name
  const pinQuality = useCallback(
    (name: string) => setSelection({ clipId, name, pinned: true }),
    [clipId],
  )
  const fallbackQuality = useCallback(
    (name: string) => setSelection({ clipId, name, pinned: false }),
    [clipId],
  )

  // Quality tiers best-first with the source on top: the source endpoint
  // serves the original upload, or the derived cut for trimmed clips.
  const sources = useMemo((): RenditionSource[] => {
    return [
      {
        name: SOURCE_QUALITY_ID,
        url: clipSourceFileUrl(clipId, apiOrigin(), sourceVersion ?? undefined),
        codecs: sourceCodecs ?? "",
        contentType: trimmed ? "video/mp4" : (sourceContentType ?? "video/mp4"),
      },
      ...renditions.map((rendition) => ({
        name: rendition.name,
        url: clipRenditionFileUrl(
          clipId,
          rendition.name,
          apiOrigin(),
          rendition.version,
        ),
        codecs: rendition.codecs,
        contentType: "video/mp4",
      })),
    ]
  }, [
    clipId,
    renditions,
    sourceCodecs,
    sourceContentType,
    sourceVersion,
    trimmed,
  ])

  const renditionPlayback = useMemo(
    (): RenditionPlayback => ({
      sources,
      selected: scopedSelection.name,
      pinned: scopedSelection.pinned,
      onFallback: fallbackQuality,
    }),
    [fallbackQuality, scopedSelection, sources],
  )

  // The menu only offers tiers this browser can decode, mirroring the
  // engine's own capability filter so the highlight matches what plays.
  const playableSources = useMemo(
    () =>
      sources.filter((source) =>
        canPlaySource(source.contentType, source.codecs),
      ),
    [sources],
  )

  const qualityOptions = useMemo(() => {
    return playableSources.map((source) => {
      if (source.name === SOURCE_QUALITY_ID) {
        return { id: source.name, label: t("Source") }
      }
      const rendition = renditions.find(
        (candidate) => candidate.name === source.name,
      )
      return {
        id: source.name,
        label: rendition
          ? renditionQualityLabel(rendition, renditions)
          : source.name,
      }
    })
  }, [playableSources, renditions])

  // An unplayable or missing selection plays the best playable tier; the
  // menu highlight follows the same resolution.
  const activeQualityId =
    (
      playableSources.find((source) => source.name === selectedQualityId) ??
      playableSources[0]
    )?.name ?? selectedQualityId

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
                : t("Preparing playback...")}
          </span>
        </div>
      </div>
    )
  }

  return (
    <VideoPlayer
      src={sources[0].url}
      renditionPlayback={renditionPlayback}
      poster={poster}
      posterBlurHash={thumbnailBlurHash}
      fallbackSeed={fallbackSeed ?? clipId}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      chromeSize={chromeSize}
      className={className}
      sourceIdentity={clipId}
      qualityOptions={qualityOptions}
      selectedQualityId={activeQualityId}
      onSelectQuality={pinQuality}
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
