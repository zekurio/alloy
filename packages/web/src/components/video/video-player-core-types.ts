import type { HlsLevelSelection } from "./video-media-engine"
import type { SharedPlayerProps } from "./video-player-types"
import type { SourceSpec } from "./video-source"

export type PlayerCoreProps = SharedPlayerProps & {
  spec: SourceSpec
  identity: string
  poster?: string
  aspectRatio?: number
  controls: boolean
  autoPlay: boolean
  loop: boolean
  initialMuted: boolean
  playbackRate: number
  hlsLevelHeight?: HlsLevelSelection
  onHlsFatalError?: (message: string) => void
}
