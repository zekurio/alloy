import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import type { Dirent } from "node:fs"
import { extname, isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

import type {
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingNotificationSoundOption,
  RecordingNotificationSoundSettings,
} from "@alloy/contracts"
import { RECORDING_NOTIFICATION_SOUND_EVENTS } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app, BrowserWindow } from "electron"

const logger = createLogger("sounds")

export const RECORDING_SOUND_FILE_EXTENSIONS = [
  "wav",
  "mp3",
  "ogg",
  "m4a",
  "aac",
  "flac",
] as const

const SUPPORTED_RECORDING_SOUND_EXTENSIONS = new Set(
  RECORDING_SOUND_FILE_EXTENSIONS.map((extension) => `.${extension}`),
)

const RECORDING_SOUND_CRAWL_MAX_FILES = 500

const RECORDING_NOTIFICATION_SOUND_MATCHES: Record<
  RecordingNotificationSoundEvent,
  {
    files: readonly string[]
    terms: readonly string[]
  }
> = {
  replayBufferStarted: {
    files: ["replay_recording.wav", "start_recording.wav"],
    terms: ["replay", "buffer", "start"],
  },
  clipSaved: {
    files: ["clip_saved.wav", "save_clip.wav"],
    terms: ["clip", "save", "saved"],
  },
}

let soundPlayerWindow: BrowserWindow | null = null
let soundPlayerReady: Promise<void> | null = null

export function recordingNotificationSoundUrl(
  sound: RecordingNotificationSoundEvent,
  settings: RecordingNotificationSoundSettings,
): string | null {
  if (!settings.enabled) return null

  const customPath = normalizeCustomSoundPath(settings.path)
  if (customPath) return pathToFileURL(customPath).toString()

  const defaultPath = defaultRecordingSoundPath(sound)
  return defaultPath ? pathToFileURL(defaultPath).toString() : null
}

export function isRecordingSoundFile(path: string): boolean {
  return SUPPORTED_RECORDING_SOUND_EXTENSIONS.has(extname(path).toLowerCase())
}

/** Shared folder users drop their own notification sounds into. */
export function notificationSoundsDir(): string {
  return notificationSoundsRootDir()
}

export function ensureNotificationSoundsDir(): string {
  const dir = notificationSoundsDir()
  try {
    mkdirSync(dir, { recursive: true })
    const defaultFiles = allDefaultRecordingSoundFiles()
    for (const defaultFile of defaultFiles) {
      const source = join(recordingAssetsDir(), defaultFile)
      if (!existsSync(source)) continue

      const seeded = join(dir, defaultFile)
      if (!existsSync(seeded)) {
        copyFileSync(source, seeded)
      }
    }
  } catch (cause) {
    logger.warn("failed to prepare notification sounds folder:", cause)
  }
  return dir
}

/** Audio files available in the sounds library, ranked for this event. */
export function listNotificationSoundFiles(
  sound: RecordingNotificationSoundEvent,
): RecordingNotificationSoundOption[] {
  ensureNotificationSoundsDir()
  return rankedNotificationSoundFiles(sound, crawlNotificationSoundsRoot())
}

export function listNotificationSoundLibrary(): RecordingNotificationSoundLibrary {
  ensureNotificationSoundsDir()

  const discovered = crawlNotificationSoundsRoot()
  const library = {} as RecordingNotificationSoundLibrary
  for (const sound of RECORDING_NOTIFICATION_SOUND_EVENTS) {
    library[sound] = rankedNotificationSoundFiles(sound, discovered)
  }
  return library
}

export async function playRecordingNotificationSound(
  sound: RecordingNotificationSoundEvent,
  settings: RecordingNotificationSoundSettings,
): Promise<void> {
  const soundUrl = recordingNotificationSoundUrl(sound, settings)
  if (!soundUrl) return

  try {
    const win = await ensureSoundPlayerWindow()
    const volume = notificationSoundVolume(settings.volume)
    const played = await win.webContents.executeJavaScript(
      soundPlayerScript(soundUrl, volume),
      true,
    )
    if (played !== true) {
      logger.warn(`recording notification sound did not play: ${sound}`)
    }
  } catch (cause) {
    logger.warn(`failed to play recording notification sound: ${sound}`, cause)
  }
}

export function destroyRecordingNotificationSoundPlayer(): void {
  const win = soundPlayerWindow
  soundPlayerWindow = null
  soundPlayerReady = null
  if (win && !win.isDestroyed()) win.destroy()
}

async function ensureSoundPlayerWindow(): Promise<BrowserWindow> {
  await app.whenReady()
  if (soundPlayerWindow && !soundPlayerWindow.isDestroyed()) {
    await soundPlayerReady
    return soundPlayerWindow
  }

  const win = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    focusable: false,
    title: tx("Alloy Recording Sounds"),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  })

  win.on("closed", () => {
    if (soundPlayerWindow === win) {
      soundPlayerWindow = null
      soundPlayerReady = null
    }
  })

  soundPlayerWindow = win
  soundPlayerReady = new Promise<void>((resolve, reject) => {
    win.webContents.once("did-finish-load", () => resolve())
    win.webContents.once("did-fail-load", (_event, _code, description) =>
      reject(new Error(description)),
    )
  })

  try {
    await win.loadURL(recordingAssetsDirUrl())
    await soundPlayerReady
    return win
  } catch (cause) {
    if (!win.isDestroyed()) win.destroy()
    if (soundPlayerWindow === win) {
      soundPlayerWindow = null
      soundPlayerReady = null
    }
    throw cause
  }
}

function soundPlayerScript(soundUrl: string, volume: number): string {
  return `
    (() => {
      window.__alloyRecordingSounds ??= new Set();
      const audio = new Audio(${JSON.stringify(soundUrl)});
      audio.volume = ${JSON.stringify(volume)};
      audio.preload = "auto";
      const cleanup = () => window.__alloyRecordingSounds.delete(audio);
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      window.__alloyRecordingSounds.add(audio);
      return audio.play().then(
        () => true,
        () => {
          cleanup();
          return false;
        },
      );
    })()
  `
}

function notificationSoundVolume(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value / 100))
}

function normalizeCustomSoundPath(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed || !isAbsolute(trimmed) || !isRecordingSoundFile(trimmed)) {
    return null
  }
  return existsSync(trimmed) ? trimmed : null
}

function notificationSoundsRootDir(): string {
  return join(app.getPath("userData"), "sounds")
}

function allDefaultRecordingSoundFiles(): string[] {
  return [
    ...new Set(
      RECORDING_NOTIFICATION_SOUND_EVENTS.flatMap(
        (sound) => RECORDING_NOTIFICATION_SOUND_MATCHES[sound].files,
      ),
    ),
  ]
}

function defaultRecordingSoundPath(
  sound: RecordingNotificationSoundEvent,
): string | null {
  for (const file of RECORDING_NOTIFICATION_SOUND_MATCHES[sound].files) {
    const path = join(recordingAssetsDir(), file)
    if (existsSync(path)) return path
  }

  return null
}

function crawlNotificationSoundsRoot(): RecordingNotificationSoundOption[] {
  const root = notificationSoundsRootDir()
  try {
    mkdirSync(root, { recursive: true })
    return crawlSoundFiles(root)
  } catch (cause) {
    logger.warn("failed to list notification sounds:", cause)
    return []
  }
}

function crawlSoundFiles(root: string): RecordingNotificationSoundOption[] {
  const found: RecordingNotificationSoundOption[] = []
  const seen = new Set<string>()

  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  } catch (cause) {
    logger.warn(`failed to scan notification sounds: ${root}`, cause)
    return []
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isRecordingSoundFile(entry.name)) continue

    const path = join(root, entry.name)
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push({
      path,
      name: entry.name,
    })

    if (found.length >= RECORDING_SOUND_CRAWL_MAX_FILES) break
  }

  if (found.length >= RECORDING_SOUND_CRAWL_MAX_FILES) {
    logger.warn(
      `notification sound scan capped at ${RECORDING_SOUND_CRAWL_MAX_FILES} files`,
    )
  }

  return found
}

function rankedNotificationSoundFiles(
  sound: RecordingNotificationSoundEvent,
  files: RecordingNotificationSoundOption[],
): RecordingNotificationSoundOption[] {
  return [...files].sort((a, b) => {
    const rankDelta = soundFileRank(sound, b) - soundFileRank(sound, a)
    return rankDelta || a.name.localeCompare(b.name)
  })
}

function soundFileRank(
  sound: RecordingNotificationSoundEvent,
  option: RecordingNotificationSoundOption,
): number {
  const match = RECORDING_NOTIFICATION_SOUND_MATCHES[sound]
  const name = normalizedSoundSearchText(option.name)
  const basename = normalizedSoundSearchText(fileName(option.name))
  const defaultIndex = match.files.findIndex(
    (file) => normalizedSoundSearchText(file) === basename,
  )
  const defaultScore = defaultIndex >= 0 ? 100 - defaultIndex : 0
  const termScore = match.terms.reduce(
    (score, term) => score + (name.includes(term) ? 8 : 0),
    0,
  )

  return defaultScore + termScore
}

function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() || path
}

function normalizedSoundSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function recordingAssetsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "assets")
  return join(app.getAppPath(), "assets")
}

function recordingAssetsDirUrl(): string {
  return `${pathToFileURL(recordingAssetsDir()).toString()}/`
}
