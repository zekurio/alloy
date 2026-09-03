import type { RecordingAllowedGame } from "./desktop-recording-games"

export const RECORDING_ENCODERS = ["hardware", "software"] as const
export const RECORDING_CODECS = ["h264", "hevc", "av1"] as const
export const RECORDING_RESOLUTIONS = [
  "source",
  "720p",
  "1080p",
  "1440p",
  "2160p",
] as const
export const RECORDING_FRAME_RATES = [30, 60, 120] as const
/** "auto" lets the encoder pick; the rest are target bitrates in Mbps (steps of 5). */
export const RECORDING_BITRATES = [
  "auto",
  "5",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
] as const

/** Where the replay buffer is held while recording: RAM or scratch on disk. */
export const RECORDING_BUFFER_STORAGE = ["memory", "disk"] as const
export const RECORDING_CAPTURE_MODES = ["game", "display"] as const
export const RECORDING_CAPTURE_KINDS = ["replay"] as const
export const RECORDING_QUALITY_PROFILES = [
  "low",
  "standard",
  "high",
  "custom",
] as const
export const RECORDING_RUN_STATES = [
  "idle",
  "paused",
  "replay-buffer",
  "stopping",
  "error",
] as const
export const RECORDING_CAPTURE_SOURCES = ["game", "display"] as const
export const RECORDING_AUDIO_MODES = ["devices", "applications"] as const
export const RECORDING_AUDIO_DEVICE_KINDS = ["output", "input"] as const
export const RECORDING_NOTIFICATION_SOUND_EVENTS = [
  "replayBufferStarted",
  "clipSaved",
] as const

export type RecordingEncoder = (typeof RECORDING_ENCODERS)[number]
export type RecordingCodec = (typeof RECORDING_CODECS)[number]
export type RecordingResolution = (typeof RECORDING_RESOLUTIONS)[number]
export type RecordingFrameRate = (typeof RECORDING_FRAME_RATES)[number]
export type RecordingBitrate = (typeof RECORDING_BITRATES)[number]
export type RecordingBufferStorage = (typeof RECORDING_BUFFER_STORAGE)[number]
export type RecordingCaptureMode = (typeof RECORDING_CAPTURE_MODES)[number]
export type RecordingCaptureKind = (typeof RECORDING_CAPTURE_KINDS)[number]
export type RecordingQualityProfile =
  (typeof RECORDING_QUALITY_PROFILES)[number]
export type RecordingRunState = (typeof RECORDING_RUN_STATES)[number]
export type RecordingCaptureSource = (typeof RECORDING_CAPTURE_SOURCES)[number]
export type RecordingAudioMode = (typeof RECORDING_AUDIO_MODES)[number]
export type RecordingAudioDeviceKind =
  (typeof RECORDING_AUDIO_DEVICE_KINDS)[number]
export type RecordingNotificationSoundEvent =
  (typeof RECORDING_NOTIFICATION_SOUND_EVENTS)[number]
/**
 * Content types the desktop library handles locally. Wider than the server's
 * upload accept list (mp4 only): imported local recordings can sit in the
 * library in any of these containers — they just can't all be published.
 */
export const RECORDING_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
] as const

export type RecordingCaptureContentType =
  (typeof RECORDING_VIDEO_CONTENT_TYPES)[number]

export interface RecordingQualitySettings {
  resolution: RecordingResolution
  fps: RecordingFrameRate
  bitrate: RecordingBitrate
}

export const RECORDING_QUALITY_PRESETS: Array<
  RecordingQualitySettings & {
    id: Exclude<RecordingQualityProfile, "custom">
  }
> = [
  {
    id: "low",
    resolution: "720p",
    fps: 30,
    bitrate: "5",
  },
  {
    id: "standard",
    resolution: "1080p",
    fps: 60,
    bitrate: "15",
  },
  {
    id: "high",
    resolution: "1440p",
    fps: 60,
    bitrate: "30",
  },
]

/** Keyboard shortcuts for the capture controls (empty string = unbound). */
export interface RecordingHotkeys {
  /** Saves the full replay buffer (its length is `replayBufferSeconds`). */
  clip: string
}

export interface RecordingNotificationSoundSettings {
  enabled: boolean
  /** Playback loudness, 0-100. */
  volume: number
  /** Absolute path to a custom audio file; empty string = bundled default. */
  path: string
}

export type RecordingNotificationSounds = Record<
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundSettings
>

/** A selectable sound file discovered in the shared notification sounds folder. */
export interface RecordingNotificationSoundOption {
  /** Absolute path to the audio file. */
  path: string
  /** File name shown in the picker dropdown. */
  name: string
}

/** Available sound files per event, used to populate the sound pickers. */
export type RecordingNotificationSoundLibrary = Record<
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundOption[]
>

/** An audio device currently exposed by the capture backend. */
export interface RecordingAudioDevice {
  id: string
  label: string
  kind: RecordingAudioDeviceKind
}

export interface RecordingAudioDeviceSelection extends RecordingAudioDevice {
  enabled: boolean
  volume: number
}

export interface RecordingAudioApplicationSelection {
  id: string
  name: string
  window: string
  executable: string | null
  iconUrl: string | null
  processId: number | null
  enabled: boolean
  volume: number
}

export interface RecordingSettings {
  enabled: boolean
  captureMode: RecordingCaptureMode
  /** OBS monitor id for desktop capture; empty string = backend default. */
  selectedDisplayId: string
  /** Manual include overrides for games the automatic detector misses. */
  allowedGames: RecordingAllowedGame[]
  /** Manual exclude overrides for apps the automatic detector should ignore. */
  deniedGames: RecordingAllowedGame[]
  audioMode: RecordingAudioMode
  audioDevices: RecordingAudioDeviceSelection[]
  audioApplications: RecordingAudioApplicationSelection[]
  encoder: RecordingEncoder
  /** Selected GPU device id, or "auto" to let the backend choose. */
  gpu: string
  codec: RecordingCodec
  qualityProfile: RecordingQualityProfile
  resolution: RecordingResolution
  fps: RecordingFrameRate
  bitrate: RecordingBitrate
  customQuality: RecordingQualitySettings
  replayBufferSeconds: number
  bufferStorage: RecordingBufferStorage
  /** Absolute folder videos are written to; empty string = OS videos default. */
  outputFolder: string
  hotkeys: RecordingHotkeys
  notificationSounds: RecordingNotificationSounds
}
