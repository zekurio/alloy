import {
  clipDownloadUrl,
  clipHlsMasterUrl,
  type ClipStatus,
  clipStreamUrl,
  clipThumbnailUrl,
} from "alloy-api"
import { MediaPlaceholder } from "alloy-ui/components/media-placeholder"
import { toast } from "alloy-ui/lib/toast"
import * as React from "react"

import { hlsPlaybackSupported } from "@/components/video/video-media-engine"
import { VideoPlayer } from "@/components/video/video-player"
import { apiOrigin } from "@/lib/env"
import { canPlaySource } from "@/lib/source-playback"

const SOURCE_QUALITY_ID = "source"

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
  sourceVideoCodec,
  sourceAudioCodec,
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
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

  const sourcePlayable = canPlaySource(sourceContentType, {
    videoCodec: sourceVideoCodec,
    audioCodec: sourceAudioCodec,
  })

  // The server packages the desktop-encoded source into a single-rendition
  // HLS VOD (stream copy). Prefer it for segment-level seeking; when hls.js
  // hits a fatal error, fall back to the progressive source stream.
  const [hlsFailed, setHlsFailed] = React.useState(false)
  React.useEffect(() => {
    setHlsFailed(false)
  }, [clipId])
  const useHls = !hlsFailed && hlsPlaybackSupported()
  const hlsMasterUrl = useHls
    ? clipHlsMasterUrl(clipId, apiOrigin())
    : undefined

  const qualityOptions = sourceContentType
    ? [
        {
          id: SOURCE_QUALITY_ID,
          label: "Original",
          detail: sourcePlayable ? "Direct stream" : "Direct play attempt",
          downloadUrl: clipDownloadUrl(clipId, "source", apiOrigin()),
        },
      ]
    : []

  const handleHlsFatalError = React.useCallback(() => {
    setHlsFailed(true)
  }, [])

  const handlePlaybackError = React.useCallback(
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
      src={clipStreamUrl(clipId, SOURCE_QUALITY_ID, apiOrigin())}
      hlsMasterUrl={hlsMasterUrl}
      poster={poster}
      posterBlurHash={thumbnailBlurHash}
      fallbackSeed={fallbackSeed ?? clipId}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      chromeSize={chromeSize}
      className={className}
      sourceIdentity={clipId}
      qualityOptions={qualityOptions}
      selectedQualityId={SOURCE_QUALITY_ID}
      onPlayThreshold={onPlayThreshold}
      onEnded={onEnded}
      onPlaybackError={handlePlaybackError}
      onHlsFatalError={handleHlsFatalError}
      autoPlay={autoPlay}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
    />
  )
}

export { ClipPlayer }
