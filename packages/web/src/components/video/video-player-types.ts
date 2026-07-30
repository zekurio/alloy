import type { MouseEventHandler, Ref } from "react"

import type { AudioTrackMixerController } from "./audio-track-mixer"

export interface VideoPlayerHandle {
  play(): Promise<void>
  pause(): void
  seek(seconds: number, keepPlaying?: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setPlaybackRate(rate: number): void
}

export type QualityOption = {
  id: string
  label: string
  detail?: string
}

export type SharedPlayerProps = {
  className?: string
  maxDisplayHeight?: string
  playerRef?: Ref<VideoPlayerHandle>
  onTimeUpdate?: (seconds: number) => void
  onPlayingChange?: (playing: boolean) => void
  onVideoClick?: MouseEventHandler<HTMLVideoElement>
  onPlaybackError?: (message: string) => void
  onPlayThreshold?: () => void
  onFrameReady?: () => void
  onEnded?: () => void
  audioMixer?: AudioTrackMixerController
  chromeSize?: "default" | "compact"
  shortcutBounds?: {
    start: number
    end: number
  }
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  enableHorizontalSeekShortcuts?: boolean
}
