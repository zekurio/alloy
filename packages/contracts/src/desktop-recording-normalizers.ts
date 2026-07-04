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
import { isObjectRecord } from "./object"

const NOTIFICATION_SOUND_EVENT_ALIASES: Partial<
  Record<RecordingNotificationSoundEvent, readonly string[]>
> = {
  replayBufferStarted: ["replayRecordingStarted", "recordingStarted"],
}

export function normalizeQualitySettings(
  value: unknown,
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
  value: unknown,
): RecordingQualityProfile {
  return normalizeLiteral(
    value,
    RECORDING_QUALITY_PROFILES,
    DEFAULT_RECORDING_SETTINGS.qualityProfile,
  )
}

export function normalizeHotkeys(value: unknown): RecordingHotkeys {
  const record = isObjectRecord(value) ? value : {}
  return {
    clip: normalizeClipHotkey(record),
  }
}

export function normalizeNotificationSounds(
  value: unknown,
): RecordingNotificationSounds {
  const record = isObjectRecord(value) ? value : {}
  return {
    replayBufferStarted: normalizeNotificationSound(
      notificationSoundValue(record, "replayBufferStarted"),
      "replayBufferStarted",
    ),
    clipSaved: normalizeNotificationSound(
      notificationSoundValue(record, "clipSaved"),
      "clipSaved",
    ),
  }
}

export function normalizeAudioDevices(
  value: unknown,
): RecordingAudioDeviceSelection[] {
  if (!Array.isArray(value)) return DEFAULT_RECORDING_SETTINGS.audioDevices

  const devices = value.flatMap((entry): RecordingAudioDeviceSelection[] => {
    const record = isObjectRecord(entry) ? entry : null
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
export function normalizeReplayBufferSeconds(value: unknown): number {
  const fallback = DEFAULT_RECORDING_SETTINGS.replayBufferSeconds
  const requested =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value / 15) * 15
      : fallback

  return Math.min(600, Math.max(15, requested))
}

export function normalizeLiteral<const T extends readonly (string | number)[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  // Unknown persisted settings use defaults for version tolerance.
  return allowed.find((allowedValue) => allowedValue === value) ?? fallback
}

/**
 * Resolves the single clip hotkey, migrating legacy configs that stored an
 * array of `clips` (each with its own duration) down to the first binding.
 */
function normalizeClipHotkey(record: Record<string, unknown>): string {
  if (typeof record.clip === "string") return record.clip

  if (Array.isArray(record.clips)) {
    for (const entry of record.clips) {
      const hotkey = isObjectRecord(entry)
        ? normalizeNonEmptyString(entry.hotkey)
        : null
      if (hotkey) return hotkey
    }
  }

  return DEFAULT_RECORDING_SETTINGS.hotkeys.clip
}

function normalizeNotificationSound(
  value: unknown,
  event: RecordingNotificationSoundEvent,
): RecordingNotificationSounds[RecordingNotificationSoundEvent] {
  const fallback = DEFAULT_RECORDING_SETTINGS.notificationSounds[event]
  const record = isObjectRecord(value) ? value : {}

  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    volume: normalizeAudioVolume(record.volume),
    path: typeof record.path === "string" ? record.path.trim() : fallback.path,
  }
}

function notificationSoundValue(
  record: Record<string, unknown>,
  event: RecordingNotificationSoundEvent,
): unknown {
  if (hasOwn(record, event)) return record[event]

  for (const alias of NOTIFICATION_SOUND_EVENT_ALIASES[event] ?? []) {
    if (hasOwn(record, alias)) return record[alias]
  }

  return undefined
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
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
