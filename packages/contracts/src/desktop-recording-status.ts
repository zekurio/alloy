import type {
  RecordingAudioApplicationSelection,
  RecordingAudioDevice,
  RecordingAudioDeviceKind,
  RecordingCaptureContentType,
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingCodec,
  RecordingSettings,
} from "./desktop-recording-config"
import type { RecordingGame } from "./desktop-recording-games"
import type { RecordingLibraryDownload } from "./desktop-recording-library"
import type { DesktopShortcutsState } from "./desktop-shortcuts"
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
  /** OBS monitor ID. */
  id: string
  name: string
  width: number
  height: number
  primary: boolean
}

type RecordingCapturePostProcess =
  | { kind: "trim-tail"; keepMs: number }
  | { kind: "concat-segments"; segmentPaths: string[] }

interface RecordingCapture {
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

type RecordingBackendState = "missing" | "ready" | "error"

export interface RecordingStatus {
  backend: RecordingBackendState
  replayActive: boolean
  activeGame: string | null
  activeGameDetail: RecordingGame | null
  activeDisplay: RecordingDisplay | null
  /** GPU devices the capture backend can encode with, if detected. */
  availableGpus: string[]
  /** Video codecs the selected recorder encoder/GPU can create. */
  availableCodecs: RecordingCodec[]
  /** Audio devices the capture backend can create OBS sources for. */
  availableAudioDevices: RecordingAudioDevice[]
  /** Application audio sources available for process-only capture. */
  availableAudioApplications: RecordingAudioApplicationSelection[]
  message: string | null
}

export type RecordingEvent =
  | { type: "settings"; settings: RecordingSettings }
  | { type: "status"; status: RecordingStatus }
  | { type: "replay-buffer-started"; status: RecordingStatus }
  | {
      type: "capture-ready"
      capture: RecordingCapture
      status: RecordingStatus
    }
  | { type: "audio-levels"; levels: RecordingAudioLevel[] }
  | { type: "library-download"; download: RecordingLibraryDownload }
  | { type: "shortcuts"; state: DesktopShortcutsState }
