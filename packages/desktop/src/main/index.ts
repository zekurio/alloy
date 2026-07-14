import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { detectLocale, setRuntimeLocale } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app, BrowserWindow, Menu, protocol } from "electron"

import {
  assetCacheProtocolScheme,
  registerAssetCacheProtocol,
} from "./asset-cache"
import { WINDOWS_APP_USER_MODEL_ID, wasLaunchedAtLogin } from "./autostart"
import { registerIpc } from "./ipc"
import { installCrashLogging, installFileLogSink } from "./logging"
import {
  configureRecordingBackend,
  shutdownRecordingBackend,
} from "./recording"
import { startRecordingDiscordDetectionsRefresh } from "./recording-discord-detections"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"
import {
  cleanupLegacyFilmstripCache,
  recordingLibraryProtocolScheme,
  registerRecordingLibraryProtocol,
} from "./recording-library"
import { destroyRecordingNotificationSoundPlayer } from "./recording-notification-sounds"
import { getRecordingSettings, getStartupServerUrl } from "./server-store"
import { hasStoredSession, watchAuthCookiePersistence } from "./session"
import { createAlloyTray } from "./tray"
import { initAutoUpdater } from "./updater"
import { Windows } from "./windows"

const USER_DATA_DIR_NAME = "Alloy Desktop"
const SESSION_DATA_DIR_NAME = "session"
const LOGS_DIR_NAME = "logs"
const BACKGROUND_STARTUP_DELAY_MS = 1000

const logger = createLogger("main")

app.setName("Alloy")
setRuntimeLocale(detectLocale([app.getLocale()]))
configureAppPaths()
installFileLogSink()
installCrashLogging()
logger.info(`Alloy Desktop ${app.getVersion()} starting`)
// Privileged schemes must all be declared in this single pre-ready call.
protocol.registerSchemesAsPrivileged([
  recordingLibraryProtocolScheme(),
  assetCacheProtocolScheme(),
])

if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  app.commandLine.appendSwitch("enable-features", "OverlayScrollbar")
}

// Single-instance: a second launch focuses the existing overlay/app instead of
// spinning up a duplicate process (which would fight over the session cookie).
const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}
if (singleInstanceLock) startApp()

function startApp(): void {
  const windows = new Windows()

  app.on("second-instance", () => {
    void showOrOpenInitialWindow(windows)
  })

  app.whenReady().then(async () => {
    // Drop Electron's default File/Edit/View/Window menu for a clean,
    // app-driven chrome. (Standard editing shortcuts still work in web content
    // on Windows/Linux; revisit if macOS support needs its app menu back.)
    Menu.setApplicationMenu(null)
    registerRecordingLibraryProtocol()
    registerAssetCacheProtocol()
    watchAuthCookiePersistence()

    registerIpc(windows)
    createAlloyTray({
      showAlloy: () => showOrOpenInitialWindow(windows),
      openLibrary: () => {
        windows.openLibrary()
      },
      openSettings: () => {
        windows.openSettings()
      },
      quit: () => {
        windows.allowAppQuit()
        app.quit()
      },
    })
    // Launched as a login item: stay in the tray and keep the recording
    // backend warm; the user opens a window from the tray when needed.
    if (!wasLaunchedAtLogin()) await openInitialWindow(windows)
    scheduleBackgroundStartup()

    app.on("activate", () => {
      // macOS: re-open the connected app when possible, or the fallback connect
      // surface when no valid saved session exists.
      if (BrowserWindow.getAllWindows().length === 0) {
        void showOrOpenInitialWindow(windows)
      }
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  let recorderShutdownDone = false
  app.on("before-quit", (event) => {
    windows.allowAppQuit()
    unregisterRecordingHotkeys()
    destroyRecordingNotificationSoundPlayer()
    if (recorderShutdownDone) return
    event.preventDefault()
    void shutdownWithDeadline().finally(() => {
      recorderShutdownDone = true
      app.quit()
    })
  })
}

/** Never block quit on a hung sidecar; give shutdown a hard deadline. */
async function shutdownWithDeadline(): Promise<void> {
  await Promise.race([
    shutdownRecordingBackend().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
}

async function openInitialWindow(windows: Windows): Promise<void> {
  const startupServerUrl = getStartupServerUrl()
  if (startupServerUrl) {
    if (await hasStoredSession(startupServerUrl)) {
      windows.connectTo(startupServerUrl)
      return
    }

    windows.connectToLogin(startupServerUrl)
    return
  }

  windows.createOverlay()
}

async function showOrOpenInitialWindow(windows: Windows): Promise<void> {
  if (windows.showPrimary()) return
  await openInitialWindow(windows)
}

function configureAppPaths(): void {
  const roamingAppData = app.getPath("appData")
  const localAppData = process.env.LOCALAPPDATA || roamingAppData

  const roamingRoot = join(roamingAppData, USER_DATA_DIR_NAME)
  const localRoot = join(localAppData, USER_DATA_DIR_NAME)
  const sessionDataPath = join(localRoot, SESSION_DATA_DIR_NAME)
  const logsPath = join(localRoot, LOGS_DIR_NAME)

  for (const path of [roamingRoot, sessionDataPath, logsPath]) {
    mkdirSync(path, { recursive: true })
  }

  app.setPath("userData", roamingRoot)
  app.setPath("sessionData", sessionDataPath)
  app.setAppLogsPath(logsPath)
}

function scheduleBackgroundStartup(): void {
  const timer = setTimeout(() => {
    runBackgroundStartupTask("legacy filmstrip cleanup", () => {
      cleanupLegacyFilmstripCache()
    })
    runBackgroundStartupTask("Discord detection refresh", () => {
      startRecordingDiscordDetectionsRefresh()
    })
    runBackgroundStartupTask("auto updater", () => {
      initAutoUpdater()
    })

    const recordingSettings = getRecordingSettings()
    runBackgroundStartupTask("recording hotkeys", () => {
      configureRecordingHotkeys(recordingSettings)
    })
    if (recordingSettings.enabled) {
      void configureRecordingBackend().catch((cause: unknown) => {
        logger.warn("recording backend startup failed:", cause)
      })
    }
  }, BACKGROUND_STARTUP_DELAY_MS)
  timer.unref?.()
}

function runBackgroundStartupTask(name: string, task: () => void): void {
  try {
    task()
  } catch (cause) {
    logger.warn(`${name} startup task failed:`, cause)
  }
}
