import { useMemo } from "react"

import { PlayerCore } from "./video-player-core"
import type { SharedPlayerProps } from "./video-player-types"
import { type SourceSpec, sourceSpecKey, toSourceSpec } from "./video-source"

export { VolumeControl } from "./video-volume-control"

interface VideoPlayerProps extends SharedPlayerProps {
  src: string | File
  poster?: string
  posterBlurHash?: string | null
  fallbackSeed?: string | number
  aspectRatio?: number
  sourceIdentity?: string
  controls?: boolean
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playbackRate?: number
}

export function VideoPlayer({
  src,
  sourceIdentity,
  aspectRatio,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playbackRate = 1,
  ...rest
}: VideoPlayerProps) {
  const spec = useMemo<SourceSpec>(() => toSourceSpec(src), [src])
  const specKey = sourceSpecKey(spec)
  const identity = sourceIdentity ?? specKey

  return (
    <PlayerCore
      spec={spec}
      identity={identity}
      aspectRatio={aspectRatio}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      initialMuted={muted}
      playbackRate={playbackRate}
      {...rest}
    />
  )
}
