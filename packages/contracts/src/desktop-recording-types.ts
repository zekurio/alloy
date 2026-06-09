import type {
  AcceptedContentType,
  AcceptedImageContentType,
  IsoDateString,
} from "./shared"

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
export const RECORDING_CAPTURE_KINDS = [
  "replay",
  "long-recording",
  "screenshot",
] as const
export const RECORDING_QUALITY_PROFILES = [
  "low",
  "standard",
  "high",
  "custom",
] as const
export const RECORDING_RUN_STATES = [
  "idle",
  "recording",
  "paused",
  "replay-buffer",
  "stopping",
  "error",
] as const
export const RECORDING_CAPTURE_SOURCES = ["game", "display"] as const
export const RECORDING_AUDIO_MODES = ["devices", "applications"] as const
export const RECORDING_AUDIO_DEVICE_KINDS = ["output", "input"] as const
export const RECORDING_CHAPTER_STATUSES = ["none", "ok", "failed"] as const
export const RECORDING_NOTIFICATION_SOUND_EVENTS = [
  "recordingStarted",
  "manualRecordingStarted",
  "clipSaved",
  "screenshotTaken",
  "bookmarkAdded",
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
export type RecordingChapterStatus = (typeof RECORDING_CHAPTER_STATUSES)[number]
export type RecordingNotificationSoundEvent =
  (typeof RECORDING_NOTIFICATION_SOUND_EVENTS)[number]
export type RecordingCaptureContentType =
  | AcceptedContentType
  | AcceptedImageContentType

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
  clips: RecordingClipHotkey[]
  bookmark: string
  screenshot: string
  toggleLongRecording: string
}

export interface RecordingClipHotkey {
  id: string
  hotkey: string
  durationSeconds: number
}

export interface RecordingLongRecordingSettings {
  /** Storage-heavy opt-in: automatically record every detected game session. */
  autoRecordGames: boolean
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

/** A selectable sound file discovered in an event's notification sounds folder. */
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

export interface RecordingAudioDeviceSelection {
  id: string
  label: string
  kind: RecordingAudioDeviceKind
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

export interface RecordingAllowedGame {
  id: string
  name: string
  executable: string | null
  path: string | null
  windowClass?: string | null
  iconUrl?: string | null
}

export interface RecordingGameProcess {
  id: string
  name: string
  processId: number
  executable: string | null
  path: string | null
  windowTitle: string | null
  iconUrl: string | null
}

export interface RecordingDisplay {
  /** OBS monitor id when available, otherwise a stable Electron display id. */
  id: string
  /** Electron desktopCapturer display id, used for thumbnails/screenshots. */
  electronId: string | null
  name: string
  width: number
  height: number
  primary: boolean
  thumbnailDataUrl: string | null
}

export interface RecordingSettings {
  enabled: boolean
  captureMode: RecordingCaptureMode
  /** OBS monitor id for desktop capture; empty string = backend default. */
  selectedDisplayId: string
  longRecording: RecordingLongRecordingSettings
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

export interface RecordingGame {
  /** Stable detector id when known, e.g. a Discord/arRPC application id. */
  id: string | null
  name: string
  processId: number
  executable: string | null
  path: string | null
  iconUrl?: string | null
  windowTitle?: string | null
  windowClass?: string | null
  startedAt: IsoDateString | null
}

export interface RecordingCapture {
  id: string
  filename: string
  contentType: RecordingCaptureContentType
  sizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  game: RecordingGame | null
  source: RecordingCaptureSource
  kind: RecordingCaptureKind
  chapterStatus: RecordingChapterStatus
  chapterError: string | null
  createdAt: IsoDateString
}

/** Disk usage for the capture output location, as shown in storage settings. */
export interface RecordingStorageInfo {
  /** Absolute folder clips are written to. */
  outputFolder: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  /** Bytes consumed specifically by Alloy clips. */
  clipsBytes: number
}

export type RecordingMode = "idle" | "recording" | "replay-buffer"
export type RecordingBackendState = "missing" | "ready" | "error"

export interface RecordingStatus {
  backend: RecordingBackendState
  /** Current capture engine mode exposed to the desktop UI. */
  mode: RecordingMode
  captureMode: RecordingCaptureMode
  runState: RecordingRunState
  replayActive: boolean
  longRecordingActive: boolean
  activeGame: string | null
  activeGameDetail: RecordingGame | null
  activeDisplay: RecordingDisplay | null
  focused: boolean
  currentSource: RecordingCaptureSource | null
  currentCapture: RecordingCapture | null
  replayBufferSeconds: number
  /** GPU devices the capture backend can encode with, if detected. */
  availableGpus: string[]
  /** Video codecs the selected recorder encoder/GPU can create. */
  availableCodecs: RecordingCodec[]
  /** Audio devices the capture backend can create OBS sources for. */
  availableAudioDevices: RecordingAudioDeviceSelection[]
  /** Application audio sources available for process-only capture. */
  availableAudioApplications: RecordingAudioApplicationSelection[]
  message: string | null
}

export type RecordingActionResult =
  | { ok: true; status: RecordingStatus; capture?: RecordingCapture }
  | { ok: false; error: string; status: RecordingStatus }

export interface RecordingActionRequest {
  requestedAtUnixMs: number
}

export interface SaveReplayClipRequest extends RecordingActionRequest {
  durationSeconds: number
}

export type RecordingEvent =
  | { type: "settings"; settings: RecordingSettings }
  | { type: "status"; status: RecordingStatus }
  | { type: "recording-started"; status: RecordingStatus }
  | { type: "game-started"; game: RecordingGame; status: RecordingStatus }
  | {
      type: "game-focus-changed"
      game: RecordingGame | null
      focused: boolean
      status: RecordingStatus
    }
  | { type: "game-ended"; game: RecordingGame; status: RecordingStatus }
  | {
      type: "capture-ready"
      capture: RecordingCapture
      status: RecordingStatus
    }
  | { type: "error"; error: string; status: RecordingStatus }
