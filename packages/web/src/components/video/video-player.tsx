import * as React from "react"

import type { HlsLevelSelection } from "./video-media-engine"
import { PlayerCore } from "./video-player-core"
import type { SharedPlayerProps } from "./video-player-types"
import { type SourceSpec, sourceSpecKey, toSourceSpec } from "./video-source"

export { VolumeControl } from "./video-volume-control"

interface VideoPlayerProps extends SharedPlayerProps {
  src: string | File
  /** When set, playback uses this HLS master playlist instead of `src`. */
  hlsMasterUrl?: string
  /** Selected HLS rendition (target height, or "auto"). */
  hlsLevelHeight?: HlsLevelSelection
  onHlsFatalError?: (message: string) => void
  poster?: string
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
  hlsMasterUrl,
  sourceIdentity,
  aspectRatio,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playbackRate = 1,
  ...rest
}: VideoPlayerProps) {
  const spec = React.useMemo<SourceSpec>(
    () =>
      hlsMasterUrl ? { kind: "hls", url: hlsMasterUrl } : toSourceSpec(src),
    [hlsMasterUrl, src],
  )
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
