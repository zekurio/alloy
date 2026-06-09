import { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
import {
  RECORDING_AUDIO_DEVICE_KINDS,
  RECORDING_BITRATES,
  RECORDING_FRAME_RATES,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  RECORDING_QUALITY_PROFILES,
  RECORDING_RESOLUTIONS,
  type RecordingAllowedGame,
  type RecordingAudioApplicationSelection,
  type RecordingAudioDeviceSelection,
  type RecordingClipHotkey,
  type RecordingHotkeys,
  type RecordingLongRecordingSettings,
  type RecordingNotificationSoundEvent,
  type RecordingNotificationSounds,
  type RecordingQualityProfile,
  type RecordingQualitySettings,
} from "./desktop-recording-types"

export function normalizeQualitySettings(
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

export function normalizeQualityProfile(
  value: unknown,
): RecordingQualityProfile {
  return normalizeLiteral(
    value,
    RECORDING_QUALITY_PROFILES,
    DEFAULT_RECORDING_SETTINGS.qualityProfile,
  )
}

export function normalizeHotkeys(value: unknown): RecordingHotkeys {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const toHotkey = (raw: unknown, fallback: string) =>
    typeof raw === "string" ? raw : fallback
  return {
    clips: normalizeClipHotkeys(record.clips),
    bookmark: toHotkey(
      record.bookmark,
      DEFAULT_RECORDING_SETTINGS.hotkeys.bookmark,
    ),
    screenshot: toHotkey(
      record.screenshot,
      DEFAULT_RECORDING_SETTINGS.hotkeys.screenshot,
    ),
    toggleLongRecording: toHotkey(
      record.toggleLongRecording,
      DEFAULT_RECORDING_SETTINGS.hotkeys.toggleLongRecording,
    ),
  }
}

export function normalizeLongRecording(
  value: unknown,
): RecordingLongRecordingSettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    autoRecordGames:
      typeof record.autoRecordGames === "boolean"
        ? record.autoRecordGames
        : DEFAULT_RECORDING_SETTINGS.longRecording.autoRecordGames,
  }
}

export function normalizeNotificationSounds(
  value: unknown,
): RecordingNotificationSounds {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const sounds = {} as RecordingNotificationSounds

  for (const event of RECORDING_NOTIFICATION_SOUND_EVENTS) {
    sounds[event] = normalizeNotificationSound(record[event], event)
  }

  return sounds
}

export function normalizeAudioDevices(
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

export function normalizeAudioApplications(
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

export function normalizeAllowedGames(value: unknown): RecordingAllowedGame[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.allowedGames

  const games = value.flatMap((entry): RecordingAllowedGame[] => {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : null
    if (!record) return []

    const path = normalizeNullableString(record.path)
    const executable =
      normalizeNonEmptyString(record.executable) ??
      (path ? pathFileName(path) : null)
    const windowClass = normalizeNullableString(record.windowClass)
    const iconUrl = normalizeNullableString(record.iconUrl)
    if (!path && !executable && !windowClass) return []

    const name =
      normalizeNonEmptyString(record.name) ??
      executableName(executable) ??
      pathFileName(path ?? "") ??
      "Game"

    return [
      {
        id:
          normalizeNonEmptyString(record.id) ??
          `game:${slug([path, executable, windowClass, name].join(":"))}`,
        name,
        executable,
        path,
        windowClass,
        iconUrl,
      },
    ]
  })

  return dedupeBy(games, allowedGameKey)
}

export function normalizeReplayBufferSeconds(
  value: unknown,
  hotkeys: RecordingHotkeys = DEFAULT_RECORDING_SETTINGS.hotkeys,
): number {
  const fallback = DEFAULT_RECORDING_SETTINGS.replayBufferSeconds
  const requested =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback
  const longestClip = hotkeys.clips.reduce(
    (longest, hotkey) => Math.max(longest, hotkey.durationSeconds),
    fallback,
  )

  return Math.min(600, Math.max(15, requested, longestClip))
}

export function normalizeLiteral<const T extends readonly (string | number)[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback
}

function normalizeClipHotkeys(value: unknown): RecordingClipHotkey[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.hotkeys.clips

  const hotkeys = value.flatMap((entry, index): RecordingClipHotkey[] => {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : null
    if (!record) return []

    const hotkey = normalizeNonEmptyString(record.hotkey)
    if (!hotkey) return []

    return [
      {
        id: normalizeNonEmptyString(record.id) ?? `clip-${index + 1}`,
        hotkey,
        durationSeconds: normalizeClipDuration(record.durationSeconds),
      },
    ]
  })

  return hotkeys.length > 0 ? dedupeBy(hotkeys, (hotkey) => hotkey.id) : []
}

function normalizeNotificationSound(
  value: unknown,
  event: RecordingNotificationSoundEvent,
): RecordingNotificationSounds[RecordingNotificationSoundEvent] {
  const fallback = DEFAULT_RECORDING_SETTINGS.notificationSounds[event]
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}

  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    volume: normalizeAudioVolume(record.volume),
    path: typeof record.path === "string" ? record.path.trim() : fallback.path,
  }
}

function allowedGameKey(game: RecordingAllowedGame): string {
  return [game.path, game.executable, game.windowClass]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .join(":")
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

function pathFileName(path: string): string | null {
  const name = path.replaceAll("\\", "/").split("/").pop()?.trim()
  return name ? name : null
}

function executableName(executable: string | null): string | null {
  if (!executable) return null
  const name = executable.replace(/\.[^.]+$/, "").trim()
  return name ? name : executable
}

function slug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "allowed"
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

function normalizeClipDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RECORDING_SETTINGS.hotkeys.clips[0]?.durationSeconds ?? 90
  }

  return Math.min(600, Math.max(15, Math.round(value)))
}
