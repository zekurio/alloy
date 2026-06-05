import {
  CLIP_MEDIA_BACKGROUND_CLASS,
  CLIP_MEDIA_CLASS,
  CLIP_VIDEO_MEDIA_CLASS,
} from "@workspace/ui/lib/media-frame"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

type VideoFrameProps = {
  videoRef: React.Ref<HTMLVideoElement>
  mediaUrl: string | null
  poster?: string
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
      {/* The poster overlays the video (it must paint on top of the element's
          opaque background) and fades out once a real frame has decoded, so a
          source swap shows the thumbnail instead of a black box. */}
      {poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden
          className={cn(
            CLIP_MEDIA_CLASS,
            "pointer-events-none transition-opacity duration-200 ease-out",
            posterVisible ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          fetchPriority="high"
        />
      ) : null}
    </>
  )
}
