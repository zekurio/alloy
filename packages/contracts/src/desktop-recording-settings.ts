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
import type { ContractJsonInput } from "./json-value"
import { isBooleanValue, isObjectRecord, isStringValue } from "./object"

export { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
export { normalizeReplayBufferSeconds } from "./desktop-recording-normalizers"

export function normalizeRecordingSettings(
  value: ContractJsonInput,
): RecordingSettings {
  if (!isObjectRecord(value)) {
    return DEFAULT_RECORDING_SETTINGS
  }

  const quality = normalizeQualitySettings(value, DEFAULT_RECORDING_SETTINGS)
  const customQuality = normalizeQualitySettings(value.customQuality, quality)
  const qualityProfile = normalizeQualityProfile(value.qualityProfile)
  const hotkeys = normalizeHotkeys(value.hotkeys)

  return {
    enabled: isBooleanValue(value.enabled)
      ? value.enabled
      : DEFAULT_RECORDING_SETTINGS.enabled,
    captureMode: normalizeLiteral(
      value.captureMode,
      RECORDING_CAPTURE_MODES,
      DEFAULT_RECORDING_SETTINGS.captureMode,
    ),
    selectedDisplayId: isStringValue(value.selectedDisplayId)
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
      isStringValue(value.gpu) && value.gpu.length > 0
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
    outputFolder: isStringValue(value.outputFolder) ? value.outputFolder : "",
    hotkeys,
    notificationSounds: normalizeNotificationSounds(value.notificationSounds),
  }
}
