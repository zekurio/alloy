import { normalizeRecordingSettings } from "alloy-contracts"
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron"

import type { ConnectResult, ProbeResult } from "../shared/ipc"
import { IPC } from "../shared/ipc"
import { loginViaBrowser } from "./browser-login"
import { probeServer } from "./probe"
import {
  configureRecordingBackend,
  getRecordingStatus,
  getRecordingStorageInfo,
  onRecordingEvent,
  resolveRevealableCapturePath,
  saveReplayClip,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  forgetServer,
  getLastServerUrl,
  getRecordingSettings,
  getSavedServers,
  rememberServer,
  saveRecordingSettings,
} from "./server-store"
import { clearRemoteWebCache, hasValidSession } from "./session"
import type { Windows } from "./windows"

const SETUP_REQUIRED_ERROR =
  "This Alloy server needs setup. Finish setup in your browser, then connect again."

/**
 * Register the overlay's privileged IPC surface. Handlers are intentionally
 * thin: validate input, mutate persisted state, drive the windows. All channels
 * are request/response (`handle`) so the overlay gets typed results back.
 */
export function registerIpc(windows: Windows): void {
  registerRecordingEvents()
  registerServerIpc(windows)
  registerRecordingIpc(windows)
}

function registerRecordingEvents(): void {
  onRecordingEvent((recordingEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.recordingEvent, recordingEvent)
      }
    }
  })
}

function registerServerIpc(windows: Windows): void {
  ipcMain.handle(IPC.probe, (event, url: unknown): Promise<ProbeResult> => {
    requireOverlaySender(windows, event)
    if (typeof url !== "string") {
      return Promise.resolve({ ok: false, error: "Enter a server URL." })
    }
    return probeServer(url)
  })

  ipcMain.handle(
    IPC.connect,
    async (event, url: unknown): Promise<ConnectResult> => {
      requireDesktopSender(windows, event)
      if (typeof url !== "string") {
        return { ok: false, error: "Enter a server URL." }
      }
      // Re-probe before committing so we only ever persist + load a URL we just
      // confirmed is a reachable Alloy server.
      const result = await probeServer(url)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.config.setupRequired) {
        await shell
          .openExternal(new URL("/setup", result.serverUrl).toString())
          .catch(() => undefined)
        return { ok: false, error: SETUP_REQUIRED_ERROR }
      }

      // Electron can't run passkeys/embedded OAuth, so unless a stored session
      // is still valid we authenticate in the system browser and inject the
      // resulting session before loading the app.
      if (!(await hasValidSession(result.serverUrl))) {
        const login = await loginViaBrowser(result.serverUrl)
        if (!login.ok) return { ok: false, error: login.error }
      }

      rememberServer(result.serverUrl)
      await clearRemoteWebCache()
      windows.connectTo(result.serverUrl)
      return { ok: true, serverUrl: result.serverUrl }
    },
  )

  ipcMain.handle(IPC.getLastServer, (event): string | null => {
    requireOverlaySender(windows, event)
    return getLastServerUrl()
  })
  ipcMain.handle(IPC.getServers, (event) => {
    requireDesktopSender(windows, event)
    return getSavedServers()
  })
  ipcMain.handle(IPC.forgetServer, (event, url: unknown) => {
    requireDesktopSender(windows, event)
    if (typeof url !== "string") return getSavedServers()
    return forgetServer(url)
  })
}

function registerRecordingIpc(windows: Windows): void {
  ipcMain.handle(IPC.getRecordingSettings, (event) => {
    requireMainSender(windows, event)
    return getRecordingSettings()
  })
  ipcMain.handle(IPC.setRecordingSettings, async (event, settings: unknown) => {
    requireMainSender(windows, event)
    const saved = saveRecordingSettings(normalizeRecordingSettings(settings))
    void configureRecordingBackend()
    configureRecordingHotkeys(saved)
    return saved
  })
  ipcMain.handle(IPC.getRecordingStatus, (event) => {
    requireMainSender(windows, event)
    return getRecordingStatus()
  })
  ipcMain.handle(IPC.getRecordingStorageInfo, (event) => {
    requireMainSender(windows, event)
    return getRecordingStorageInfo()
  })
  ipcMain.handle(
    IPC.selectOutputFolder,
    async (event): Promise<string | null> => {
      requireMainSender(windows, event)
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: "Choose capture folder",
        properties: ["openDirectory", "createDirectory"],
      }
      const result = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))
      const folder = result.filePaths[0]
      if (result.canceled || !folder) return null

      const current = getRecordingSettings()
      saveRecordingSettings(
        normalizeRecordingSettings({ ...current, outputFolder: folder }),
      )
      void configureRecordingBackend()
      configureRecordingHotkeys()
      return folder
    },
  )
  ipcMain.handle(IPC.saveReplayClip, (event) => {
    requireMainSender(windows, event)
    return saveReplayClip()
  })
  ipcMain.handle(IPC.revealRecordingCapture, (event, filename: unknown) => {
    requireMainSender(windows, event)
    if (typeof filename !== "string" || filename.length === 0) return
    const capturePath = resolveRevealableCapturePath(filename)
    if (capturePath) shell.showItemInFolder(capturePath)
  })
}

function requireOverlaySender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (!windows.canUseOverlayBridge(event.sender)) throw unauthorizedIpcError()
}

function requireMainSender(windows: Windows, event: IpcMainInvokeEvent): void {
  if (!windows.canUseMainBridge(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

function requireDesktopSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (
    !windows.canUseDesktopBridge(event.sender, event.senderFrame?.url ?? "")
  ) {
    throw unauthorizedIpcError()
  }
}

function unauthorizedIpcError(): Error {
  return new Error("Unauthorized desktop IPC sender.")
}
