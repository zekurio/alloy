import {
  RECORDING_BITRATES,
  RECORDING_AUDIO_DEVICE_KINDS,
  RECORDING_AUDIO_MODES,
  RECORDING_BUFFER_STORAGE,
  RECORDING_CODECS,
  RECORDING_ENCODERS,
  RECORDING_FRAME_RATES,
  RECORDING_TRIGGER_MODES,
  RECORDING_QUALITY_PRESETS,
  RECORDING_RESOLUTIONS,
  type RecordingActionResult,
  type RecordingEvent,
  type RecordingSettings,
  type RecordingStatus,
  type RecordingStorageInfo,
} from "alloy-contracts"

/**
 * Bridge exposed by the Alloy desktop shell's main-window preload. Absent in a
 * browser.
 */
interface AlloyDesktop {
  platform: string
  titlebarOverlay: boolean
  servers: AlloyDesktopServerApi
  recording: AlloyDesktopRecordingApi
}

export type DesktopConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; error: string }

export interface DesktopSavedServer {
  serverUrl: string
  lastConnectedAt: string
}

interface AlloyDesktopServerApi {
  connect(url: string): Promise<DesktopConnectResult>
  getServers(): Promise<DesktopSavedServer[]>
  forgetServer(url: string): Promise<DesktopSavedServer[]>
}

export const DESKTOP_RECORDING_ENCODERS = RECORDING_ENCODERS
export const DESKTOP_RECORDING_CODECS = RECORDING_CODECS
export const DESKTOP_RECORDING_RESOLUTIONS = RECORDING_RESOLUTIONS
export const DESKTOP_RECORDING_FRAME_RATES = RECORDING_FRAME_RATES
export const DESKTOP_RECORDING_BITRATES = RECORDING_BITRATES
export const DESKTOP_RECORDING_AUDIO_MODES = RECORDING_AUDIO_MODES
export const DESKTOP_RECORDING_AUDIO_DEVICE_KINDS = RECORDING_AUDIO_DEVICE_KINDS
export const DESKTOP_RECORDING_BUFFER_STORAGE = RECORDING_BUFFER_STORAGE
export const DESKTOP_RECORDING_TRIGGER_MODES = RECORDING_TRIGGER_MODES
export const DESKTOP_RECORDING_QUALITY_PRESETS = RECORDING_QUALITY_PRESETS

interface AlloyDesktopRecordingApi {
  getSettings(): Promise<RecordingSettings>
  setSettings(settings: RecordingSettings): Promise<RecordingSettings>
  getStatus(): Promise<RecordingStatus>
  getStorageInfo(): Promise<RecordingStorageInfo>
  onEvent(listener: (event: RecordingEvent) => void): () => void
  selectOutputFolder(): Promise<string | null>
  saveReplayClip(): Promise<RecordingActionResult>
  revealCapture(filename: string): Promise<void>
}

export function alloyDesktop(): AlloyDesktop | null {
  return (globalThis as { alloyDesktop?: AlloyDesktop }).alloyDesktop ?? null
}
