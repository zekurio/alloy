import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { extname, isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

import type {
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingNotificationSoundOption,
  RecordingNotificationSoundSettings,
} from "@alloy/contracts"
import { RECORDING_NOTIFICATION_SOUND_EVENTS } from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { app, BrowserWindow } from "electron"

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

const DEFAULT_RECORDING_SOUND_FILES: Record<
  RecordingNotificationSoundEvent,
  string
> = {
  recordingStarted: "start_recording.wav",
  manualRecordingStarted: "start_recording.wav",
  clipSaved: "bookmark.wav",
  screenshotTaken: "bookmark.wav",
  bookmarkAdded: "bookmark.wav",
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

  const defaultPath = join(
    recordingAssetsDir(),
    DEFAULT_RECORDING_SOUND_FILES[sound],
  )
  return existsSync(defaultPath) ? pathToFileURL(defaultPath).toString() : null
}

export function isRecordingSoundFile(path: string): boolean {
  return SUPPORTED_RECORDING_SOUND_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Per-event folder users drop their own notification sounds into. Returned by
 * {@link ensureNotificationSoundsDir} after it's created and seeded with the
 * bundled default so the sound picker always has at least one entry.
 */
export function notificationSoundsDir(
  sound: RecordingNotificationSoundEvent,
): string {
  return join(app.getPath("userData"), "sounds", sound)
}

export function ensureNotificationSoundsDir(
  sound: RecordingNotificationSoundEvent,
): string {
  const dir = notificationSoundsDir(sound)
  try {
    mkdirSync(dir, { recursive: true })
    const defaultFile = DEFAULT_RECORDING_SOUND_FILES[sound]
    const seeded = join(dir, defaultFile)
    if (!existsSync(seeded)) {
      const source = join(recordingAssetsDir(), defaultFile)
      if (existsSync(source)) copyFileSync(source, seeded)
    }
  } catch (cause) {
    logger.warn(
      `[desktop] failed to prepare notification sounds folder: ${sound}`,
      cause,
    )
  }
  return dir
}

/** Audio files available in an event's sounds folder, sorted by name. */
export function listNotificationSoundFiles(
  sound: RecordingNotificationSoundEvent,
): RecordingNotificationSoundOption[] {
  const dir = ensureNotificationSoundsDir(sound)
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isRecordingSoundFile(entry.name))
      .map((entry) => ({ name: entry.name, path: join(dir, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (cause) {
    logger.warn(`[desktop] failed to list notification sounds: ${sound}`, cause)
    return []
  }
}

export function listNotificationSoundLibrary(): RecordingNotificationSoundLibrary {
  const library = {} as RecordingNotificationSoundLibrary
  for (const sound of RECORDING_NOTIFICATION_SOUND_EVENTS) {
    library[sound] = listNotificationSoundFiles(sound)
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
      logger.warn(
        `[desktop] recording notification sound did not play: ${sound}`,
      )
    }
  } catch (cause) {
    logger.warn(
      `[desktop] failed to play recording notification sound: ${sound}`,
      cause,
    )
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
    title: "Alloy Recording Sounds",
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
    await win.loadFile(join(recordingAssetsDir(), "sound-player.html"))
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

function recordingAssetsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "assets")
  return join(app.getAppPath(), "assets")
}
