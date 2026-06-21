import { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
import {
  normalizeAllowedGames,
  normalizeAudioApplications,
  normalizeAudioDevices,
  normalizeHotkeys,
  normalizeLiteral,
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
import { isObjectRecord } from "./object"

export { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
export { normalizeReplayBufferSeconds } from "./desktop-recording-normalizers"

export function normalizeRecordingSettings(value: unknown): RecordingSettings {
  if (!isObjectRecord(value)) {
    return DEFAULT_RECORDING_SETTINGS
  }

  const quality = normalizeQualitySettings(value, DEFAULT_RECORDING_SETTINGS)
  const customQuality = normalizeQualitySettings(value.customQuality, quality)
  const qualityProfile = normalizeQualityProfile(value.qualityProfile)
  const hotkeys = normalizeHotkeys(value.hotkeys)

  return {
    enabled:
      typeof value.enabled === "boolean"
        ? value.enabled
        : DEFAULT_RECORDING_SETTINGS.enabled,
    captureMode: normalizeLiteral(
      value.captureMode,
      RECORDING_CAPTURE_MODES,
      DEFAULT_RECORDING_SETTINGS.captureMode,
    ),
    selectedDisplayId:
      typeof value.selectedDisplayId === "string"
        ? value.selectedDisplayId
        : DEFAULT_RECORDING_SETTINGS.selectedDisplayId,
    allowedGames: normalizeAllowedGames(value.allowedGames),
    deniedGames: normalizeAllowedGames(value.deniedGames),
    audioMode: normalizeLiteral(
      value.audioMode,
      RECORDING_AUDIO_MODES,
      DEFAULT_RECORDING_SETTINGS.audioMode,
    ),
    audioDevices: normalizeAudioDevices(value.audioDevices),
    audioApplications: normalizeAudioApplications(value.audioApplications),
    encoder: normalizeLiteral(
      value.encoder,
      RECORDING_ENCODERS,
      DEFAULT_RECORDING_SETTINGS.encoder,
    ),
    gpu:
      typeof value.gpu === "string" && value.gpu.length > 0
        ? value.gpu
        : DEFAULT_RECORDING_SETTINGS.gpu,
    codec: normalizeLiteral(
      value.codec,
      RECORDING_CODECS,
      DEFAULT_RECORDING_SETTINGS.codec,
    ),
    qualityProfile,
    resolution: quality.resolution,
    fps: quality.fps,
    bitrate: quality.bitrate,
    customQuality,
    replayBufferSeconds: normalizeReplayBufferSeconds(
      value.replayBufferSeconds,
    ),
    bufferStorage: normalizeLiteral(
      value.bufferStorage,
      RECORDING_BUFFER_STORAGE,
      DEFAULT_RECORDING_SETTINGS.bufferStorage,
    ),
    outputFolder:
      typeof value.outputFolder === "string" ? value.outputFolder : "",
    hotkeys,
    notificationSounds: normalizeNotificationSounds(value.notificationSounds),
  }
}
