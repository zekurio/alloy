import type { SharedPlayerProps } from "./video-player-types"
import type { SourceSpec } from "./video-source"

export type PlayerCoreProps = SharedPlayerProps & {
  spec: SourceSpec
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
