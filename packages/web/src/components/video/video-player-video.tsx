import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import {
  CLIP_MEDIA_BACKGROUND_CLASS,
  CLIP_MEDIA_CLASS,
  CLIP_VIDEO_MEDIA_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useState } from "react"
import type {
  MouseEventHandler,
  PointerEventHandler,
  ReactEventHandler,
  Ref,
} from "react"

type VideoFrameProps = {
  videoRef: Ref<HTMLVideoElement>
  mediaUrl: string | null
  poster?: string
  posterBlurHash?: string | null
  fallbackSeed: string | number
  aspectRatio?: number
  placeholderVisible: boolean
  posterVisible: boolean
  autoPlay: boolean
  loop: boolean
  muted: boolean
  onPointerDown: PointerEventHandler<HTMLVideoElement>
  onClick?: MouseEventHandler<HTMLVideoElement>
  onLoadedMetadata: ReactEventHandler<HTMLVideoElement>
  onLoadedData: ReactEventHandler<HTMLVideoElement>
  onCanPlay: ReactEventHandler<HTMLVideoElement>
  onWaiting: ReactEventHandler<HTMLVideoElement>
  onStalled: ReactEventHandler<HTMLVideoElement>
  onPlaying: ReactEventHandler<HTMLVideoElement>
  onDurationChange: ReactEventHandler<HTMLVideoElement>
  onTimeUpdate: ReactEventHandler<HTMLVideoElement>
  onProgress: ReactEventHandler<HTMLVideoElement>
  onPlay: ReactEventHandler<HTMLVideoElement>
  onPause: ReactEventHandler<HTMLVideoElement>
  onEnded: ReactEventHandler<HTMLVideoElement>
  onError: ReactEventHandler<HTMLVideoElement>
}

const PLACEHOLDER_GRACE_MS = 200

export function VideoFrame({
  videoRef,
  mediaUrl,
  poster,
  posterBlurHash,
  fallbackSeed,
  aspectRatio,
  placeholderVisible,
  posterVisible,
  autoPlay,
  loop,
  muted,
  onPointerDown,
  onClick,
  onLoadedMetadata,
  onLoadedData,
  onCanPlay,
  onWaiting,
  onStalled,
  onPlaying,
  onDurationChange,
  onTimeUpdate,
  onProgress,
  onPlay,
  onPause,
  onEnded,
  onError,
}: VideoFrameProps) {
  const posterImage = useImageLoaded(poster)
  const [graceElapsed, setGraceElapsed] = useState(false)

  // Hold the placeholder back for a grace window: local files and cached
  // sources paint their first frame within it, and flashing the gradient for
  // that blink is worse than showing the container background.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setGraceElapsed(true),
      PLACEHOLDER_GRACE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [])

  // Hold the blurhash only until the poster is painted (or, posterless, until
  // the first video frame); showing it under a not-yet-decoded poster is the
  // flash we're avoiding.
  const blurHashVisible =
    placeholderVisible && !posterImage.loaded && graceElapsed

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
        onCanPlay={onCanPlay}
        onWaiting={onWaiting}
        onStalled={onStalled}
        onPlaying={onPlaying}
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
        aspectRatio={aspectRatio}
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
          ref={posterImage.ref}
          src={poster}
          alt=""
          aria-hidden
          className={cn(
            CLIP_MEDIA_CLASS,
            "pointer-events-none transition-opacity duration-200 ease-out",
            posterVisible && posterImage.loaded ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          fetchPriority="high"
          onLoad={posterImage.markLoaded}
        />
      ) : null}
    </>
  )
}
