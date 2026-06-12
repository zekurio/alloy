import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { app, BrowserWindow, Menu, protocol } from "electron"

import {
  assetCacheProtocolScheme,
  registerAssetCacheProtocol,
} from "./asset-cache"
import { ensureDeviceRegistered } from "./device-identity"
import { registerIpc } from "./ipc"
import {
  configureRecordingBackend,
  onRecordingEvent,
  shutdownRecordingBackend,
  stopRecording,
} from "./recording"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"
import {
  cleanupLegacyFilmstripCache,
  recordingLibraryProtocolScheme,
  registerRecordingLibraryProtocol,
} from "./recording-library"
import {
  kickRecordingLibrarySync,
  registerRecordingLibrarySync,
} from "./recording-library-sync"
import { destroyRecordingNotificationSoundPlayer } from "./recording-notification-sounds"
import { registerRecordingSessionTracking } from "./recording-session-tracker"
import { getStartupServerUrl } from "./server-store"
import { hasValidSession } from "./session"
import { createAlloyTray } from "./tray"
import { Windows } from "./windows"

const WINDOWS_APP_USER_MODEL_ID = "dev.zekurio.alloy.desktop"
const USER_DATA_DIR_NAME = "Alloy Desktop"
const SESSION_DATA_DIR_NAME = "session"
const LOGS_DIR_NAME = "logs"

app.setName("Alloy")
configureAppPaths()
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
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
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
    cleanupLegacyFilmstripCache()

    registerIpc(windows)
    // Session tracking and the sync queue must be listening before the
    // sidecar starts emitting game events.
    registerRecordingSessionTracking(onRecordingEvent)
    registerRecordingLibrarySync()
    configureRecordingHotkeys()
    // Push settings to the recording sidecar once at startup so background
    // capture and hotkeys work before any window asks for recording state.
    void configureRecordingBackend()
    createAlloyTray({
      showAlloy: () => showOrOpenInitialWindow(windows),
      openLibrary: () => {
        windows.openLibrary()
      },
      openSettings: () => {
        windows.openSettings()
      },
      stopRecording: async () => {
        await stopRecording()
      },
      quit: () => {
        windows.allowAppQuit()
        app.quit()
      },
    })
    await openInitialWindow(windows)

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
  if (startupServerUrl && (await hasValidSession(startupServerUrl))) {
    windows.connectTo(startupServerUrl)
    // Signed in: refresh this device's registration and drain any sync
    // items left over from the previous run.
    void ensureDeviceRegistered(startupServerUrl).catch(() => undefined)
    kickRecordingLibrarySync()
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
