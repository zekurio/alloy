import { app, BrowserWindow, Menu } from "electron"

import { registerIpc } from "./ipc"
import { shutdownRecordingBackend } from "./recording"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"
import { destroyRecordingHud } from "./recording-hud"
import { getLastServerUrl } from "./server-store"
import { hasValidSession } from "./session"
import { Windows } from "./windows"

const WINDOWS_APP_USER_MODEL_ID = "dev.zekurio.alloy.desktop"

app.setName("Alloy")

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
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  app.whenReady().then(async () => {
    // Drop Electron's default File/Edit/View/Window menu for a clean,
    // app-driven chrome. (Standard editing shortcuts still work in web content
    // on Windows/Linux; revisit if macOS support needs its app menu back.)
    Menu.setApplicationMenu(null)

    registerIpc(windows)
    configureRecordingHotkeys()
    await openInitialWindow(windows)

    app.on("activate", () => {
      // macOS: re-open the connected app when possible, or the fallback connect
      // surface when no valid saved session exists.
      if (BrowserWindow.getAllWindows().length === 0) {
        void openInitialWindow(windows)
      }
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", () => {
    unregisterRecordingHotkeys()
    destroyRecordingHud()
    void shutdownRecordingBackend()
  })
}

async function openInitialWindow(windows: Windows): Promise<void> {
  const lastServerUrl = getLastServerUrl()
  if (lastServerUrl && (await hasValidSession(lastServerUrl))) {
    windows.connectTo(lastServerUrl)
    return
  }

  windows.createOverlay()
}
