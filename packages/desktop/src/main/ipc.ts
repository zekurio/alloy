import { normalizeRecordingSettings } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"

import type { ConnectResult, ProbeResult } from "@/shared/ipc"
import { IPC } from "@/shared/ipc"

import { getAutostartState, setAutostartEnabled } from "./autostart"
import { loginViaBrowser } from "./browser-login"
import { showDesktopNotification } from "./desktop-notification"
import {
  requireControllableWindow,
  requireDesktopSender,
  requireDesktopServerStateSender,
  requireMainSender,
  requireOverlaySender,
} from "./ipc-guards"
import {
  isNotificationSoundEvent,
  normalizeSaveReplayClipRequest,
} from "./ipc-normalizers"
import { registerRecordingLibraryIpc } from "./ipc-recording-library"
import { probeServer } from "./probe"
import {
  configureRecordingBackend,
  emitRecordingSettingsEvent,
  getRecordingStatus,
  getRecordingStorageInfo,
  listGameProcesses,
  listRecordingDisplays,
  onRecordingEvent,
  restartRecordingBackend,
  resolveRevealableCapturePath,
  saveReplayClip,
  stopAudioLevels,
  subscribeRecordingAudioLevels,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  ensureNotificationSoundsDir,
  listNotificationSoundLibrary,
  playRecordingNotificationSound,
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
import {
  checkForUpdatesNow,
  getUpdateState,
  onUpdateStateChange,
  restartToInstallUpdate,
} from "./updater"
import type { Windows } from "./windows"

const SETUP_REQUIRED_ERROR =
  "This Alloy server needs setup. Finish setup in your browser, then connect again."
const CONNECT_SESSION_VALIDATION_TIMEOUT_MS = 2500

/**
 * Register the overlay's privileged IPC surface. Handlers are intentionally
 * thin: validate input, mutate persisted state, drive the windows. All channels
 * are request/response (`handle`) so the overlay gets typed results back.
 */
export function registerIpc(windows: Windows): void {
  registerRecordingEvents()
  registerServerIpc(windows)
  registerRecordingIpc(windows)
  registerUpdateIpc(windows)
  registerAutostartIpc(windows)
  registerNotificationIpc(windows)
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

function registerUpdateIpc(windows: Windows): void {
  onUpdateStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.updateEvent, state)
      }
    }
  })
  ipcMain.handle(IPC.getUpdateState, (event) => {
    requireDesktopSender(windows, event)
    return getUpdateState()
  })
  ipcMain.handle(IPC.checkForUpdates, (event) => {
    requireDesktopSender(windows, event)
    return checkForUpdatesNow()
  })
  ipcMain.handle(IPC.restartToInstallUpdate, (event) => {
    requireDesktopSender(windows, event)
    restartToInstallUpdate()
  })
}

function registerAutostartIpc(windows: Windows): void {
  ipcMain.handle(IPC.getAutostart, (event) => {
    requireMainSender(windows, event)
    return getAutostartState()
  })
  ipcMain.handle(IPC.setAutostart, (event, enabled: unknown) => {
    requireMainSender(windows, event)
    return setAutostartEnabled(enabled === true)
  })
}

function registerNotificationIpc(windows: Windows): void {
  ipcMain.handle(IPC.showNotification, (event, input: unknown) => {
    requireMainSender(windows, event)
    showDesktopNotification(windows, input)
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
    async (event, url: unknown, options: unknown): Promise<ConnectResult> => {
      requireDesktopSender(windows, event)
      if (typeof url !== "string") {
        return { ok: false, error: "Enter a server URL." }
      }
      const forceBrowserLogin = connectOptions(options).forceBrowserLogin
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
      const needsBrowserLogin =
        forceBrowserLogin ||
        !(await hasValidSession(result.serverUrl, {
          timeoutMs: CONNECT_SESSION_VALIDATION_TIMEOUT_MS,
        }))
      if (needsBrowserLogin) {
        const login = await loginViaBrowser(result.serverUrl)
        if (!login.ok) return { ok: false, error: login.error }
      }

      rememberServer(result.serverUrl)
      await clearRemoteWebCache()
      windows.connectTo(result.serverUrl)
      return { ok: true, serverUrl: result.serverUrl }
    },
  )
  ipcMain.handle(IPC.openConnect, (event) => {
    requireDesktopSender(windows, event)
    windows.openConnect()
  })
  ipcMain.handle(IPC.openLibrary, (event) => {
    requireMainSender(windows, event)
    windows.openLibrary()
  })

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
      return
    }
    window.maximize()
  })
  ipcMain.handle(IPC.closeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.close()
  })
}

function connectOptions(value: unknown): { forceBrowserLogin: boolean } {
  if (!value || typeof value !== "object") return { forceBrowserLogin: false }
  return {
    forceBrowserLogin:
      (value as { forceBrowserLogin?: unknown }).forceBrowserLogin === true,
  }
}

function registerRecordingIpc(windows: Windows): void {
  registerRecordingSettingsIpc(windows)
  registerRecordingStorageIpc(windows)
  registerRecordingLibraryIpc(windows)
  registerRecordingSoundIpc(windows)
  registerRecordingSourceIpc(windows)
  registerRecordingActionIpc(windows)
}

function registerRecordingSettingsIpc(windows: Windows): void {
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
  ipcMain.handle(IPC.restartRecordingBackend, (event) => {
    requireMainSender(windows, event)
    return restartRecordingBackend()
  })
  ipcMain.handle(IPC.getRecordingStatus, (event) => {
    requireMainSender(windows, event)
    return getRecordingStatus()
  })
}

function registerRecordingStorageIpc(windows: Windows): void {
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
        title: t("Choose capture folder"),
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
}

function registerRecordingSoundIpc(windows: Windows): void {
  ipcMain.handle(IPC.listNotificationSounds, (event) => {
    requireMainSender(windows, event)
    return listNotificationSoundLibrary()
  })
  ipcMain.handle(
    IPC.openNotificationSoundsFolder,
    async (event, sound: unknown): Promise<void> => {
      requireMainSender(windows, event)
      if (!isNotificationSoundEvent(sound)) return
      const openError = await shell.openPath(ensureNotificationSoundsDir())
      if (openError) throw new Error(openError)
    },
  )
  ipcMain.handle(
    IPC.previewNotificationSound,
    async (event, sound: unknown): Promise<void> => {
      requireMainSender(windows, event)
      if (!isNotificationSoundEvent(sound)) return
      // Audition the configured sound regardless of whether the event is
      // enabled, so users can hear their pick before turning it on.
      const settings = getRecordingSettings().notificationSounds[sound]
      await playRecordingNotificationSound(sound, {
        ...settings,
        enabled: true,
      })
    },
  )
}

function registerRecordingSourceIpc(windows: Windows): void {
  ipcMain.handle(IPC.listGameProcesses, async (event) => {
    requireMainSender(windows, event)
    return listGameProcesses()
  })
  ipcMain.handle(IPC.listRecordingDisplays, async (event) => {
    requireMainSender(windows, event)
    return listRecordingDisplays()
  })
  ipcMain.handle(IPC.subscribeRecordingAudioLevels, async (event) => {
    requireMainSender(windows, event)
    return subscribeRecordingAudioLevels()
  })
  ipcMain.handle(IPC.stopAudioLevels, async (event) => {
    requireMainSender(windows, event)
    return stopAudioLevels()
  })
}

function registerRecordingActionIpc(windows: Windows): void {
  ipcMain.handle(IPC.saveReplayClip, (event, request: unknown) => {
    requireMainSender(windows, event)
    return saveReplayClip(normalizeSaveReplayClipRequest(request))
  })
  ipcMain.handle(IPC.revealRecordingCapture, (event, filename: unknown) => {
    requireMainSender(windows, event)
    if (typeof filename !== "string" || filename.length === 0) return
    const capturePath = resolveRevealableCapturePath(filename)
    if (capturePath) shell.showItemInFolder(capturePath)
  })
}
