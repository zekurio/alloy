import { useMemo } from "react"

import type { RenditionPlayback } from "./video-media-engine"
import { PlayerCore } from "./video-player-core"
import type {
  MediaPlaybackRange,
  SharedPlayerProps,
} from "./video-player-types"
import { type SourceSpec, sourceSpecKey, toSourceSpec } from "./video-source"

export { useExternalVideoVolume, VolumeControl } from "./video-volume-control"

interface VideoPlayerProps extends SharedPlayerProps {
  src: string | File
  /** Rendition config for sources with committed tiers; src stays the fallback. */
  renditionPlayback?: RenditionPlayback | null
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
  /** Initial position in this player's zero-based timeline, in seconds. */
  initialTime?: number
  /** Window in `src` that maps to this player's zero-based timeline. */
  playbackRange?: MediaPlaybackRange
}

export function VideoPlayer({
  src,
  renditionPlayback,
  sourceIdentity,
  aspectRatio,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playbackRate = 1,
  initialTime = 0,
  playbackRange,
  ...rest
}: VideoPlayerProps) {
  const spec = useMemo<SourceSpec>(() => toSourceSpec(src), [src])
  const specKey = sourceSpecKey(spec)
  const identity = sourceIdentity ?? specKey

  return (
    <PlayerCore
      spec={spec}
      renditionPlayback={renditionPlayback}
      identity={identity}
      aspectRatio={aspectRatio}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      initialMuted={muted}
      initialTime={initialTime}
      playbackRate={playbackRate}
      playbackRange={playbackRange}
      {...rest}
    />
  )
}
