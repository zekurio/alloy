import * as React from "react"

import {
  clipDownloadUrl,
  clipStreamUrl,
  clipThumbnailUrl,
  type ClipEncodedVariant,
} from "../lib/clips-api"
import { VideoPlayer } from "./video-player"

interface ClipPlayerProps {
  /** Real clip id — drives both the stream URL and the default poster. */
  clipId: string
  /** MIME type of the uploaded source, used to decide if native playback can start on source quality. */
  sourceContentType?: string
  thumbnail?: string
  variants?: ClipEncodedVariant[]
  onPlayThreshold?: () => void
  onAspectRatio?: (ratio: number) => void
  className?: string
}

const FALLBACK_ENCODED_OPTION = {
  id: "encoded",
  label: "Playback MP4",
}

function canPlayNativeVideo(contentType: string | undefined): boolean {
  if (!contentType || typeof document === "undefined") return false
  const video = document.createElement("video")
  return video.canPlayType(contentType) !== ""
}

function ClipPlayer({
  clipId,
  sourceContentType,
  thumbnail,
  variants = [],
  onPlayThreshold,
  onAspectRatio,
  className,
}: ClipPlayerProps) {
  const poster = thumbnail ?? clipThumbnailUrl(clipId)
  const sortedVariants = React.useMemo(
    () =>
      variants
        .filter((variant) => variant.id !== "source")
        .sort((a, b) => b.height - a.height),
    [variants]
  )
  const encodedQualityOptions =
    sortedVariants.length > 0
      ? sortedVariants.map((variant) => ({
          id: variant.id,
          label: variant.label,
        }))
      : [FALLBACK_ENCODED_OPTION]
  const defaultEncodedId =
    sortedVariants.find((variant) => variant.isDefault)?.id ??
    sortedVariants[0]?.id ??
    FALLBACK_ENCODED_OPTION.id

  const [sourcePlayable, setSourcePlayable] = React.useState(false)
  React.useEffect(() => {
    setSourcePlayable(canPlayNativeVideo(sourceContentType))
  }, [sourceContentType])

  const preferredQualityId = sourcePlayable ? "source" : defaultEncodedId
  const [selectedQualityId, setSelectedQualityId] =
    React.useState(preferredQualityId)

  React.useEffect(() => {
    setSelectedQualityId(preferredQualityId)
  }, [clipId, preferredQualityId])

  // Source leads the list, but encoded MP4 remains the compatibility fallback.
  const qualityOptions = [
    { id: "source", label: "Source" },
    ...encodedQualityOptions,
  ]

  const downloadOptions = [
    {
      id: "source",
      label: "Original source",
      url: clipDownloadUrl(clipId, "source"),
    },
    ...(sortedVariants.length > 0
      ? sortedVariants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          url: clipDownloadUrl(clipId, variant.id),
        }))
      : [
          {
            ...FALLBACK_ENCODED_OPTION,
            url: clipDownloadUrl(clipId, "encoded"),
          },
        ]),
  ]

  const src = clipStreamUrl(clipId, selectedQualityId)

  return (
    <VideoPlayer
      src={src}
      poster={poster}
      className={className}
      sourceIdentity={`${clipId}:${selectedQualityId}`}
      qualityOptions={qualityOptions}
      selectedQualityId={selectedQualityId}
      onSelectQuality={setSelectedQualityId}
      downloadOptions={downloadOptions}
      onPlaybackError={() => {
        if (selectedQualityId === "source") {
          setSourcePlayable(false)
          setSelectedQualityId(defaultEncodedId)
        }
      }}
      onPlayThreshold={onPlayThreshold}
      onAspectRatio={onAspectRatio}
    />
  )
}

export { ClipPlayer, type ClipPlayerProps }
