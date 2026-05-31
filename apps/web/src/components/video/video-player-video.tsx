import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

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
      <div aria-hidden className="absolute inset-0 bg-[oklch(12%_0.01_250)]" />
      {posterVisible ? (
        <img
          src={poster}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 size-full object-contain object-center",
            "transition-opacity duration-200 ease-out"
          )}
          decoding="async"
          fetchPriority="high"
        />
      ) : null}
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
        // A non-zero `clip-path` inset stops Chromium from promoting the video
        // to a hardware *underlay* — a plane that punches a transparent hole
        // through the page layers, ignores ancestor `overflow`/`clip-path`, and
        // rounds ~1px past the box, showing as a bright hairline of uncovered
        // video beneath the chrome. A real clip region forces the normal raster
        // path so the edge stays inside the box. The inset must be non-zero:
        // `inset(0)` clips nothing and is optimised away, leaving the underlay
        // in place. 1px is below perceptible crop for object-contain content.
        className="absolute inset-0 block h-full w-full object-contain object-center [clip-path:inset(1px)]"
      />
    </>
  )
}
