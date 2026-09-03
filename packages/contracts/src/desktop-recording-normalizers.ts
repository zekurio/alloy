import { DEFAULT_RECORDING_SETTINGS } from "./desktop-recording-defaults"
import {
  RECORDING_AUDIO_DEVICE_KINDS,
  RECORDING_BITRATES,
  RECORDING_FRAME_RATES,
  RECORDING_QUALITY_PROFILES,
  RECORDING_RESOLUTIONS,
  type RecordingAllowedGame,
  type RecordingAudioApplicationSelection,
  type RecordingAudioDeviceSelection,
  type RecordingHotkeys,
  type RecordingNotificationSoundEvent,
  type RecordingNotificationSounds,
  type RecordingQualityProfile,
  type RecordingQualitySettings,
} from "./desktop-recording-types"
import type { ContractJsonInput, ContractJsonValue } from "./json-value"
import {
  isBooleanValue,
  isFiniteNumberValue,
  isObjectRecord,
  isStringValue,
} from "./object"

export function normalizeQualitySettings(
  value: ContractJsonInput,
  fallback: RecordingQualitySettings,
): RecordingQualitySettings {
  const record = isObjectRecord(value) ? value : {}
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
  value: ContractJsonInput,
): RecordingQualityProfile {
  return normalizeLiteral(
    value,
    RECORDING_QUALITY_PROFILES,
    DEFAULT_RECORDING_SETTINGS.qualityProfile,
  )
}

export function normalizeHotkeys(value: ContractJsonInput): RecordingHotkeys {
  const record = isObjectRecord(value) ? value : {}
  return {
    clip: normalizeClipHotkey(record),
  }
}

export function normalizeNotificationSounds(
  value: ContractJsonInput,
): RecordingNotificationSounds {
  const record = isObjectRecord(value) ? value : {}
  return {
    replayBufferStarted: normalizeNotificationSound(
      record.replayBufferStarted,
      "replayBufferStarted",
    ),
    clipSaved: normalizeNotificationSound(record.clipSaved, "clipSaved"),
  }
}

export function normalizeAudioDevices(
  value: ContractJsonInput,
): RecordingAudioDeviceSelection[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.audioDevices

  const devices = value.flatMap((entry): RecordingAudioDeviceSelection[] => {
    const record = isObjectRecord(entry) ? entry : null
    if (!record) return []

    const id = normalizeNonEmptyString(record.id)
    if (!id || id === "communications") return []

    const kind = normalizeLiteral(
      record.kind,
      RECORDING_AUDIO_DEVICE_KINDS,
      "output",
    )
    return [
      {
        id,
        label: normalizeNonEmptyString(record.label) ?? id,
        kind,
        enabled: isBooleanValue(record.enabled) ? record.enabled : true,
        volume: normalizeAudioVolume(record.volume),
      },
    ]
  })

  return dedupeBy(devices, (device) => `${device.kind}:${device.id}`)
}

export function normalizeAudioApplications(
  value: ContractJsonInput,
): RecordingAudioApplicationSelection[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.audioApplications

  const applications = value.flatMap(
    (entry): RecordingAudioApplicationSelection[] => {
      const record = isObjectRecord(entry) ? entry : null
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
          enabled: isBooleanValue(record.enabled) ? record.enabled : true,
          volume: normalizeAudioVolume(record.volume),
        },
      ]
    },
  )

  return dedupeBy(applications, (application) => application.id)
}

export function normalizeAllowedGames(
  value: ContractJsonInput,
): RecordingAllowedGame[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.allowedGames

  const games = value.flatMap((entry): RecordingAllowedGame[] => {
    const record = isObjectRecord(entry) ? entry : null
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

/**
 * The replay buffer is both the rolling window length and the clip duration
 * saved by the clip hotkey. Snap to the 15s slider grid so the stored value
 * always lines up with the UI control.
 */
export function normalizeReplayBufferSeconds(value: ContractJsonInput): number {
  const fallback = DEFAULT_RECORDING_SETTINGS.replayBufferSeconds
  const requested = isFiniteNumberValue(value)
    ? Math.round(value / 15) * 15
    : fallback

  return Math.min(600, Math.max(15, requested))
}

export function normalizeLiteral<const T extends readonly (string | number)[]>(
  value: ContractJsonInput,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = allowed.find((allowedValue) => allowedValue === value)
  if (normalized !== undefined) return normalized
  return fallback
}

function normalizeClipHotkey(
  record: Record<string, ContractJsonValue>,
): string {
  return (
    normalizeNonEmptyString(record.clip) ??
    DEFAULT_RECORDING_SETTINGS.hotkeys.clip
  )
}

function normalizeNotificationSound(
  value: ContractJsonInput,
  event: RecordingNotificationSoundEvent,
): RecordingNotificationSounds[RecordingNotificationSoundEvent] {
  const fallback = DEFAULT_RECORDING_SETTINGS.notificationSounds[event]
  const record = isObjectRecord(value) ? value : {}

  return {
    enabled: isBooleanValue(record.enabled) ? record.enabled : fallback.enabled,
    volume: normalizeAudioVolume(record.volume),
    path: isStringValue(record.path) ? record.path.trim() : fallback.path,
  }
}

function allowedGameKey(game: RecordingAllowedGame): string {
  return [game.path, game.executable, game.windowClass]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .join(":")
}

function normalizeAudioVolume(value: ContractJsonInput): number {
  if (!isFiniteNumberValue(value)) return 100
  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalizeNonEmptyString(value: ContractJsonInput): string | null {
  if (!isStringValue(value)) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNullableString(value: ContractJsonInput): string | null {
  return isStringValue(value) && value.trim().length > 0 ? value : null
}

function normalizeNullableNumber(value: ContractJsonInput): number | null {
  return isFiniteNumberValue(value) ? Math.trunc(value) : null
}

function pathFileName(path: string): string | null {
  const name = path.replaceAll("\\", "/").split("/").pop()?.trim()
  return name ? name : null
}

function executableName(executable: string | null): string | null {
  if (!executable) return null
  const name = executable.replace(/\.[^.]+$/, "").trim()
  return name || executable
}

function slug(value: string): string {
  const slugChars: string[] = []
  let needsSeparator = false

  for (const char of value.toLowerCase()) {
    const isSlugChar =
      (char >= "a" && char <= "z") || (char >= "0" && char <= "9")

    if (isSlugChar) {
      if (needsSeparator && slugChars.length > 0) slugChars.push("-")
      slugChars.push(char)
      needsSeparator = false
      continue
    }

    needsSeparator = slugChars.length > 0
  }

  return slugChars.length > 0 ? slugChars.join("") : "allowed"
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
