import {
  normalizeRecordingSettings,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  type RecordingNotificationSoundEvent,
} from "alloy-contracts"
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
  emitRecordingSettingsEvent,
  getRecordingStatus,
  getRecordingStorageInfo,
  listGameProcesses,
  onRecordingEvent,
  resolveRevealableCapturePath,
  saveReplayClip,
  stopRecording,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  ensureNotificationSoundsDir,
  listNotificationSoundLibrary,
} from "./recording-notification-sounds"
import {
  forgetServer,
  getRecordingSettings,
  getSavedServers,
  getStartupServerUrl,
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

  ipcMain.handle(IPC.getStartupServer, (event): string | null => {
    requireOverlaySender(windows, event)
    return getStartupServerUrl()
  })
  ipcMain.handle(IPC.getServers, (event) => {
    requireDesktopServerStateSender(windows, event)
    return getSavedServers()
  })
  ipcMain.handle(IPC.getCurrentServer, (event) => {
    requireDesktopServerStateSender(windows, event)
    return windows.currentServerUrl()
  })
  ipcMain.handle(IPC.forgetServer, (event, url: unknown) => {
    requireDesktopSender(windows, event)
    if (typeof url !== "string") return getSavedServers()
    return forgetServer(url)
  })
  ipcMain.handle(IPC.openSettings, (event) => {
    requireDesktopSender(windows, event)
    windows.openSettings()
  })
  ipcMain.handle(IPC.minimizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.minimize()
  })
  ipcMain.handle(IPC.toggleMaximizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })
  ipcMain.handle(IPC.closeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.close()
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
    emitRecordingSettingsEvent()
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
      const saved = saveRecordingSettings(
        normalizeRecordingSettings({ ...current, outputFolder: folder }),
      )
      emitRecordingSettingsEvent()
      void configureRecordingBackend()
      configureRecordingHotkeys(saved)
      return folder
    },
  )
  ipcMain.handle(IPC.listNotificationSounds, (event) => {
    requireMainSender(windows, event)
    return listNotificationSoundLibrary()
  })
  ipcMain.handle(
    IPC.openNotificationSoundsFolder,
    async (event, sound: unknown): Promise<void> => {
      requireMainSender(windows, event)
      if (!isNotificationSoundEvent(sound)) return
      const openError = await shell.openPath(ensureNotificationSoundsDir(sound))
      if (openError) throw new Error(openError)
    },
  )
  ipcMain.handle(IPC.listGameProcesses, async (event) => {
    requireMainSender(windows, event)
    return listGameProcesses()
  })
  ipcMain.handle(IPC.saveReplayClip, (event) => {
    requireMainSender(windows, event)
    return saveReplayClip()
  })
  ipcMain.handle(IPC.stopRecording, (event) => {
    requireMainSender(windows, event)
    return stopRecording()
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
  if (!windows.canUseAppBridge(event.sender, event.senderFrame?.url ?? "")) {
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

function requireDesktopServerStateSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (
    !windows.canUseDesktopServerStateBridge(
      event.sender,
      event.senderFrame?.url ?? "",
    )
  ) {
    throw unauthorizedIpcError()
  }
}

function requireControllableWindow(
  windows: Windows,
  event: IpcMainInvokeEvent,
): BrowserWindow {
  requireMainSender(windows, event)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw unauthorizedIpcError()
  return window
}

function unauthorizedIpcError(): Error {
  return new Error("Unauthorized desktop IPC sender.")
}

function isNotificationSoundEvent(
  value: unknown,
): value is RecordingNotificationSoundEvent {
  return RECORDING_NOTIFICATION_SOUND_EVENTS.includes(
    value as RecordingNotificationSoundEvent,
  )
}
