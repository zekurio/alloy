import {
  RECORDING_BITRATES,
  RECORDING_AUDIO_DEVICE_KINDS,
  RECORDING_AUDIO_MODES,
  RECORDING_BUFFER_STORAGE,
  RECORDING_CODECS,
  RECORDING_ENCODERS,
  RECORDING_FRAME_RATES,
  RECORDING_QUALITY_PRESETS,
  RECORDING_QUALITY_PROFILES,
  RECORDING_RESOLUTIONS,
  RECORDING_TRIGGER_MODES,
  type RecordingAudioApplicationSelection,
  type RecordingAudioDeviceSelection,
  type RecordingHotkeys,
  type RecordingQualityProfile,
  type RecordingQualitySettings,
  type RecordingSettings,
} from "./desktop-recording-types"

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  enabled: false,
  triggerMode: "replay-buffer",
  recordDesktop: false,
  audioMode: "devices",
  audioDevices: [
    {
      id: "default",
      label: "Default output",
      kind: "output",
      enabled: true,
      volume: 100,
    },
  ],
  audioApplications: [],
  encoder: "hardware",
  gpu: "auto",
  codec: "h264",
  qualityProfile: "custom",
  resolution: "1080p",
  fps: 60,
  bitrate: "auto",
  customQuality: {
    resolution: "1080p",
    fps: 60,
    bitrate: "auto",
  },
  replayBufferSeconds: 120,
  bufferStorage: "memory",
  outputFolder: "",
  hotkeys: { saveClip: "F8" },
  autoCategorizeGames: true,
}

export function normalizeRecordingSettings(value: unknown): RecordingSettings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_RECORDING_SETTINGS
  }

  const record = value as Record<string, unknown>
  const quality = normalizeQualitySettings(record, DEFAULT_RECORDING_SETTINGS)
  const customQuality = normalizeQualitySettings(record.customQuality, quality)
  const qualityProfile = normalizeQualityProfile(record.qualityProfile, quality)

  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_RECORDING_SETTINGS.enabled,
    triggerMode: normalizeLiteral(
      record.triggerMode,
      RECORDING_TRIGGER_MODES,
      DEFAULT_RECORDING_SETTINGS.triggerMode,
    ),
    recordDesktop:
      typeof record.recordDesktop === "boolean"
        ? record.recordDesktop
        : DEFAULT_RECORDING_SETTINGS.recordDesktop,
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
    ),
    bufferStorage: normalizeLiteral(
      record.bufferStorage,
      RECORDING_BUFFER_STORAGE,
      DEFAULT_RECORDING_SETTINGS.bufferStorage,
    ),
    outputFolder:
      typeof record.outputFolder === "string" ? record.outputFolder : "",
    hotkeys: normalizeHotkeys(record.hotkeys),
    autoCategorizeGames:
      typeof record.autoCategorizeGames === "boolean"
        ? record.autoCategorizeGames
        : DEFAULT_RECORDING_SETTINGS.autoCategorizeGames,
  }
}

function normalizeQualitySettings(
  value: unknown,
  fallback: RecordingQualitySettings,
): RecordingQualitySettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    resolution: normalizeLiteral(
      record.resolution,
      RECORDING_RESOLUTIONS,
      fallback.resolution,
    ),
    fps: normalizeLiteral(record.fps, RECORDING_FRAME_RATES, fallback.fps),
    bitrate: normalizeLiteral(
      record.bitrate,
      RECORDING_BITRATES,
      fallback.bitrate,
    ),
  }
}

function normalizeQualityProfile(
  value: unknown,
  quality: RecordingQualitySettings,
): RecordingQualityProfile {
  if (RECORDING_QUALITY_PROFILES.includes(value as RecordingQualityProfile)) {
    return value as RecordingQualityProfile
  }

  return (
    RECORDING_QUALITY_PRESETS.find((preset) =>
      qualitySettingsEqual(preset, quality),
    )?.id ?? "custom"
  )
}

function qualitySettingsEqual(
  a: RecordingQualitySettings,
  b: RecordingQualitySettings,
): boolean {
  return (
    a.resolution === b.resolution && a.fps === b.fps && a.bitrate === b.bitrate
  )
}

function normalizeHotkeys(value: unknown): RecordingHotkeys {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const toHotkey = (raw: unknown, fallback: string) =>
    typeof raw === "string" ? raw : fallback
  return {
    saveClip: toHotkey(
      record.saveClip,
      DEFAULT_RECORDING_SETTINGS.hotkeys.saveClip,
    ),
  }
}

function normalizeAudioDevices(
  value: unknown,
): RecordingAudioDeviceSelection[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.audioDevices

  const devices = value.flatMap((entry): RecordingAudioDeviceSelection[] => {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : null
    if (!record) return []

    const id = normalizeNonEmptyString(record.id)
    if (!id) return []

    return [
      {
        id,
        label: normalizeNonEmptyString(record.label) ?? id,
        kind: normalizeLiteral(
          record.kind,
          RECORDING_AUDIO_DEVICE_KINDS,
          "output",
        ),
        enabled: typeof record.enabled === "boolean" ? record.enabled : true,
        volume: normalizeAudioVolume(record.volume),
      },
    ]
  })

  return dedupeBy(devices, (device) => `${device.kind}:${device.id}`)
}

function normalizeAudioApplications(
  value: unknown,
): RecordingAudioApplicationSelection[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.audioApplications

  const applications = value.flatMap(
    (entry): RecordingAudioApplicationSelection[] => {
      const record =
        typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>)
          : null
      if (!record) return []

      const window = normalizeNonEmptyString(record.window) ?? ""
      const name = normalizeNonEmptyString(record.name) ?? window
      const id = normalizeNonEmptyString(record.id) ?? window
      if (!id || !name) return []

      return [
        {
          id,
          name,
          window,
          executable: normalizeNullableString(record.executable),
          iconUrl: normalizeNullableString(record.iconUrl),
          processId: normalizeNullableNumber(record.processId),
          enabled: typeof record.enabled === "boolean" ? record.enabled : true,
          volume: normalizeAudioVolume(record.volume),
        },
      ]
    },
  )

  return dedupeBy(applications, (application) => application.id)
}

function normalizeAudioVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100
  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyFor(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeReplayBufferSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RECORDING_SETTINGS.replayBufferSeconds
  }

  return Math.min(600, Math.max(15, Math.round(value)))
}

function normalizeLiteral<const T extends readonly (string | number)[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback
}
