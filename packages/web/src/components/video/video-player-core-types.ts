import type { HlsPlayback } from "./video-media-engine"
import type { SharedPlayerProps } from "./video-player-types"
import type { SourceSpec } from "./video-source"

export type PlayerCoreProps = SharedPlayerProps & {
  spec: SourceSpec
  hlsPlayback?: HlsPlayback | null
  identity: string
  poster?: string
  posterBlurHash?: string | null
  fallbackSeed?: string | number
  aspectRatio?: number
  controls: boolean
  autoPlay: boolean
  loop: boolean
  initialMuted: boolean
  playbackRate: number
}
