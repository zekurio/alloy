import type {
  RecordingAudioApplicationSelection,
  RecordingAudioDevice,
  RecordingAudioDeviceKind,
  RecordingAudioTrackKind,
  RecordingBufferStorage,
  RecordingCaptureContentType,
  RecordingCaptureKind,
  RecordingCaptureMode,
  RecordingCaptureSource,
  RecordingCodec,
  RecordingEncoder,
  RecordingRunState,
  RecordingSettings,
} from "./desktop-recording-config"
import type { RecordingGame } from "./desktop-recording-games"
import type { RecordingLibraryDownload } from "./desktop-recording-library"
import type { IsoDateString } from "./shared"

/**
 * Live loudness sample for one audio source, emitted by the capture backend
 * while a meter UI holds an audio-levels subscription open.
 */
export interface RecordingAudioLevel {
  target: "device" | "application"
  /** Device kind for device targets; absent for application targets. */
  kind?: RecordingAudioDeviceKind
  /** Matches RecordingAudioDeviceSelection.id / RecordingAudioApplicationSelection.id. */
  id: string
  /** Linear peak amplitude 0..1, pre-volume (the UI applies the row volume). */
  peak: number
}

export interface RecordingDisplay {
  /** OBS monitor id when available, otherwise a stable Electron display id. */
  id: string
  /** Electron desktopCapturer display id, used for display previews. */
  electronId: string | null
  name: string
  width: number
  height: number
  primary: boolean
  thumbnailDataUrl: string | null
}

export type RecordingCapturePostProcess =
  | { kind: "trim-tail"; keepMs: number }
  | { kind: "concat-segments"; segmentPaths: string[] }

/**
 * One audio track of a recorded capture file, as reported by the recording
 * backend. Track 0 is always the full mix of every enabled source; higher
 * indices are per-source stems recorded at the same time. Older sidecars omit
 * the list entirely, which means the capture has a single mixed track.
 */
export interface RecordingCaptureAudioTrack {
  /**
   * Zero-based audio track index in the container file. Index 0 is always
   * the mix; stems occupy 1..N in recorded source order. Uploads re-base
   * stems to zero: container track i maps to clip stem index i - 1.
   */
  index: number
  kind: RecordingAudioTrackKind
  /** Human-readable source label, e.g. "VALORANT", "Microphone". */
  label: string
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
  postProcess: RecordingCapturePostProcess | null
  /** Audio track layout of the file; absent when only a single mixed track exists. */
  audioTracks?: RecordingCaptureAudioTrack[]
  createdAt: IsoDateString
}

export interface RecordingTelemetry {
  sampledAt: IsoDateString
  captureMode: RecordingCaptureMode
  captureSource: RecordingCaptureSource | null
  bufferStorage: RecordingBufferStorage
  encoder: RecordingEncoder
  codec: RecordingCodec
  videoEncoder: string | null
  audioEncoder: string | null
  gpu: string
  gpuAdapter: number
  gpuLabel: string | null
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  fps: number
  bitrateKbps: number
  outputActive: boolean
  paused: boolean
  activeFps: number | null
  averageFrameTimeMs: number | null
  frameIntervalMs: number | null
  renderTotalFrames: number | null
  renderLaggedFrames: number | null
  renderLaggedPercent: number | null
  outputTotalFrames: number | null
  outputDroppedFrames: number | null
  outputDroppedPercent: number | null
  outputTotalBytes: number | null
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

export type RecordingMode = "idle" | "replay-buffer"
export type RecordingBackendState = "missing" | "ready" | "error"

export interface RecordingStatus {
  backend: RecordingBackendState
  /** Current capture engine mode exposed to the desktop UI. */
  mode: RecordingMode
  captureMode: RecordingCaptureMode
  runState: RecordingRunState
  replayActive: boolean
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
  availableAudioDevices: RecordingAudioDevice[]
  /** Application audio sources available for process-only capture. */
  availableAudioApplications: RecordingAudioApplicationSelection[]
  telemetry: RecordingTelemetry | null
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
  | { type: "replay-buffer-started"; status: RecordingStatus }
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
  | {
      type: "telemetry"
      telemetry: RecordingTelemetry
      status: RecordingStatus
    }
  | { type: "error"; error: string; status: RecordingStatus }
  | { type: "audio-levels"; levels: RecordingAudioLevel[] }
  | { type: "library-download"; download: RecordingLibraryDownload }
