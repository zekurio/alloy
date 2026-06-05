import * as React from "react"

interface VideoPlayerHandle {
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
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
  selectionLabel?: string
  downloadUrl?: string
  selectable?: boolean
}

export type SharedPlayerProps = {
  className?: string
  maxDisplayHeight?: string
  playerRef?: React.Ref<VideoPlayerHandle>
  onTimeUpdate?: (seconds: number) => void
  onPlayingChange?: (playing: boolean) => void
  onVideoClick?: React.MouseEventHandler<HTMLVideoElement>
  onPlaybackError?: (message: string) => void
  onPlayThreshold?: () => void
  onEnded?: () => void
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
