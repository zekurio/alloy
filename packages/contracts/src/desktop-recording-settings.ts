import { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
import {
  normalizeAllowedGames,
  normalizeAudioApplications,
  normalizeAudioDevices,
  normalizeHotkeys,
  normalizeLiteral,
  normalizeLongRecording,
  normalizeNotificationSounds,
  normalizeQualityProfile,
  normalizeQualitySettings,
  normalizeReplayBufferSeconds,
} from "./desktop-recording-normalizers"
import {
  RECORDING_AUDIO_MODES,
  RECORDING_BUFFER_STORAGE,
  RECORDING_CAPTURE_MODES,
  RECORDING_CODECS,
  RECORDING_ENCODERS,
  type RecordingSettings,
} from "./desktop-recording-types"

export { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
export { normalizeReplayBufferSeconds } from "./desktop-recording-normalizers"

export function normalizeRecordingSettings(value: unknown): RecordingSettings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_RECORDING_SETTINGS
  }

  const record = value as Record<string, unknown>
  const quality = normalizeQualitySettings(record, DEFAULT_RECORDING_SETTINGS)
  const customQuality = normalizeQualitySettings(record.customQuality, quality)
  const qualityProfile = normalizeQualityProfile(record.qualityProfile)
  const hotkeys = normalizeHotkeys(record.hotkeys)

  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_RECORDING_SETTINGS.enabled,
    captureMode: normalizeLiteral(
      record.captureMode,
      RECORDING_CAPTURE_MODES,
      DEFAULT_RECORDING_SETTINGS.captureMode,
    ),
    selectedDisplayId:
      typeof record.selectedDisplayId === "string"
        ? record.selectedDisplayId
        : DEFAULT_RECORDING_SETTINGS.selectedDisplayId,
    longRecording: normalizeLongRecording(record.longRecording),
    allowedGames: normalizeAllowedGames(record.allowedGames),
    deniedGames: normalizeAllowedGames(record.deniedGames),
    audioMode: normalizeLiteral(
      record.audioMode,
      RECORDING_AUDIO_MODES,
      DEFAULT_RECORDING_SETTINGS.audioMode,
    ),
    audioDevices: normalizeAudioDevices(record.audioDevices),
    audioApplications: normalizeAudioApplications(record.audioApplications),
    encoder: normalizeLiteral(
      record.encoder,
      RECORDING_ENCODERS,
      DEFAULT_RECORDING_SETTINGS.encoder,
    ),
    gpu:
      typeof record.gpu === "string" && record.gpu.length > 0
        ? record.gpu
        : DEFAULT_RECORDING_SETTINGS.gpu,
    codec: normalizeLiteral(
      record.codec,
      RECORDING_CODECS,
      DEFAULT_RECORDING_SETTINGS.codec,
    ),
    qualityProfile,
    resolution: quality.resolution,
    fps: quality.fps,
    bitrate: quality.bitrate,
    customQuality,
    replayBufferSeconds: normalizeReplayBufferSeconds(
      record.replayBufferSeconds,
      hotkeys,
    ),
    bufferStorage: normalizeLiteral(
      record.bufferStorage,
      RECORDING_BUFFER_STORAGE,
      DEFAULT_RECORDING_SETTINGS.bufferStorage,
    ),
    outputFolder:
      typeof record.outputFolder === "string" ? record.outputFolder : "",
    hotkeys,
    notificationSounds: normalizeNotificationSounds(record.notificationSounds),
  }
}
