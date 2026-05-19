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
        className="absolute inset-0 block h-full w-full object-contain object-center"
      />
    </>
  )
}
