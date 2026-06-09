import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { app, BrowserWindow, Menu } from "electron"

import { registerIpc } from "./ipc"
import { shutdownRecordingBackend, stopRecording } from "./recording"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"
import { destroyRecordingNotificationSoundPlayer } from "./recording-notification-sounds"
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

    registerIpc(windows)
    configureRecordingHotkeys()
    createAlloyTray({
      showAlloy: () => showOrOpenInitialWindow(windows),
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

  app.on("before-quit", () => {
    windows.allowAppQuit()
    unregisterRecordingHotkeys()
    destroyRecordingNotificationSoundPlayer()
    void shutdownRecordingBackend()
  })
}

async function openInitialWindow(windows: Windows): Promise<void> {
  const startupServerUrl = getStartupServerUrl()
  if (startupServerUrl && (await hasValidSession(startupServerUrl))) {
    windows.connectTo(startupServerUrl)
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
