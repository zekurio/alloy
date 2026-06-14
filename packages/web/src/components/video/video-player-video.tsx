import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  CLIP_MEDIA_BACKGROUND_CLASS,
  CLIP_MEDIA_CLASS,
  CLIP_VIDEO_MEDIA_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

type VideoFrameProps = {
  videoRef: React.Ref<HTMLVideoElement>
  mediaUrl: string | null
  poster?: string
  posterBlurHash?: string | null
  fallbackSeed: string | number
  placeholderVisible: boolean
  posterVisible: boolean
  autoPlay: boolean
  loop: boolean
  muted: boolean
  onPointerDown: React.PointerEventHandler<HTMLVideoElement>
  onClick?: React.MouseEventHandler<HTMLVideoElement>
  onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>
  onLoadedData: React.ReactEventHandler<HTMLVideoElement>
  onDurationChange: React.ReactEventHandler<HTMLVideoElement>
  onTimeUpdate: React.ReactEventHandler<HTMLVideoElement>
  onProgress: React.ReactEventHandler<HTMLVideoElement>
  onPlay: React.ReactEventHandler<HTMLVideoElement>
  onPause: React.ReactEventHandler<HTMLVideoElement>
  onEnded: React.ReactEventHandler<HTMLVideoElement>
  onError: React.ReactEventHandler<HTMLVideoElement>
}

export function VideoFrame({
  videoRef,
  mediaUrl,
  poster,
  posterBlurHash,
  fallbackSeed,
  placeholderVisible,
  posterVisible,
  autoPlay,
  loop,
  muted,
  onPointerDown,
  onClick,
  onLoadedMetadata,
  onLoadedData,
  onDurationChange,
  onTimeUpdate,
  onProgress,
  onPlay,
  onPause,
  onEnded,
  onError,
}: VideoFrameProps) {
  const posterRef = React.useRef<HTMLImageElement | null>(null)
  const [posterLoaded, setPosterLoaded] = React.useState(false)

  // Seed from the element for cached posters: navigating from a grid where the
  // same thumbnail already loaded means the <img> can be `complete` before
  // React attaches `onLoad`, so that handler never fires. Without this the
  // blurhash would flash over an already-cached poster on every open.
  React.useEffect(() => {
    if (!poster) {
      setPosterLoaded(false)
      return
    }
    const img = posterRef.current
    setPosterLoaded(Boolean(img?.complete && img.naturalWidth > 0))
  }, [poster])

  // Hold the blurhash only until the poster is painted (or, posterless, until
  // the first video frame); showing it under a not-yet-decoded poster is the
  // flash we're avoiding.
  const blurHashVisible = placeholderVisible && !posterLoaded

  return (
    <>
      <div
        aria-hidden
        className={cn("absolute inset-0", CLIP_MEDIA_BACKGROUND_CLASS)}
      />
      <video
        ref={videoRef}
        src={mediaUrl ?? undefined}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        controls={false}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={onLoadedData}
        onCanPlay={onLoadedData}
        onDurationChange={onDurationChange}
        onTimeUpdate={onTimeUpdate}
        onProgress={onProgress}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onError={onError}
        // A non-zero clip region keeps Chromium from painting promoted video
        // layers past the rounded viewport. The shared media overscan hides
        // the inset itself.
        className={cn("block", CLIP_VIDEO_MEDIA_CLASS)}
      />
      <MediaPlaceholder
        seed={fallbackSeed}
        blurHash={posterBlurHash}
        className={cn(
          "pointer-events-none transition-opacity duration-200 ease-out",
          blurHashVisible ? "opacity-100" : "opacity-0",
        )}
      />
      {/* The poster overlays the video (it must paint on top of the element's
          opaque background) and fades out once a real frame has decoded, so a
          source swap shows the thumbnail instead of a black box. It only
          becomes visible once decoded so the blurhash isn't replaced by an
          empty frame mid-load. */}
      {poster ? (
        <img
          ref={posterRef}
          src={poster}
          alt=""
          aria-hidden
          className={cn(
            CLIP_MEDIA_CLASS,
            "pointer-events-none transition-opacity duration-200 ease-out",
            posterVisible && posterLoaded ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          fetchPriority="high"
          onLoad={() => setPosterLoaded(true)}
        />
      ) : null}
    </>
  )
}
