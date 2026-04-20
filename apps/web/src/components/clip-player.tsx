import * as React from "react"

import {
  clipDownloadUrl,
  clipStreamUrl,
  clipThumbnailUrl,
  type ClipEncodedVariant,
} from "../lib/clips-api"
import { VideoPlayer } from "./video-player"

/**
 * ClipPlayer — the surface that renders inside the clip dialog.
 *
 * This is now a thin wrapper around `VideoPlayer` (the shared custom
 * player). It's kept as its own component so the dialog's call site and
 * future surfaces (embed, share page, profile preview) can ask for a
 * clip by id without threading the stream + poster URL builders.
 *
 * Previously the player doubled as a mock preview with overlaid game /
 * quality badges. Those are gone — the mock surfaces now render the card
 * only, and once a user clicks in, they're on a real clip id and we play
 * the real stream. See `VideoPlayer` for the chrome itself.
 */
interface ClipPlayerProps {
  /** Real clip id — drives both the stream URL and the default poster. */
  clipId: string
  /**
   * Optional explicit thumbnail URL. When omitted we fall back to
   * `/api/clips/:id/thumbnail` — handing a pre-built URL through lets the
   * card's thumbnail request be reused as the poster without a second
   * round trip.
   */
  thumbnail?: string
  /**
   * Encoded renditions advertised by the server. Empty on legacy clips,
   * in which case the player falls back to the default playback MP4 and
   * only surfaces downloads.
   */
  variants?: ClipEncodedVariant[]
  /**
   * Fires once when the viewer has accumulated enough playback to count
   * as a real view (see `VideoPlayer` for the threshold rule). Typically
   * wired to `recordView(clipId)`; callers skip it for contexts where
   * playback doesn't count (admin previews, upload-queue previews).
   */
  onPlayThreshold?: () => void
  className?: string
}

function ClipPlayer({
  clipId,
  thumbnail,
  variants = [],
  onPlayThreshold,
  className,
}: ClipPlayerProps) {
  const poster = thumbnail ?? clipThumbnailUrl(clipId)
  const sortedVariants = React.useMemo(
    () => [...variants].sort((a, b) => b.height - a.height),
    [variants]
  )
  const defaultVariantId =
    variants.find((variant) => variant.isDefault)?.id ?? variants[0]?.id ?? null
  const [selectedVariantId, setSelectedVariantId] = React.useState<
    string | null
  >(defaultVariantId)

  React.useEffect(() => {
    setSelectedVariantId(defaultVariantId)
  }, [clipId, defaultVariantId])

  const qualityOptions = sortedVariants.map((variant) => ({
    id: variant.id,
    label: variant.label,
  }))

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
            id: "encoded",
            label: "Playback MP4",
            url: clipDownloadUrl(clipId, "encoded"),
          },
        ]),
  ]

  const src =
    selectedVariantId != null
      ? clipStreamUrl(clipId, selectedVariantId)
      : clipStreamUrl(clipId)

  return (
    <VideoPlayer
      src={src}
      poster={poster}
      className={className}
      sourceIdentity={clipId}
      qualityOptions={qualityOptions}
      selectedQualityId={selectedVariantId ?? undefined}
      onSelectQuality={setSelectedVariantId}
      downloadOptions={downloadOptions}
      onPlayThreshold={onPlayThreshold}
    />
  )
}

export { ClipPlayer, type ClipPlayerProps }
