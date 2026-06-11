import { normalizeRecordingSettings } from "@alloy/contracts"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"

import type { ConnectResult, ProbeResult } from "@/shared/ipc"
import { IPC } from "@/shared/ipc"

import { loginViaBrowser } from "./browser-login"
import {
  requireControllableWindow,
  requireDesktopSender,
  requireDesktopServerStateSender,
  requireMainSender,
  requireOverlaySender,
} from "./ipc-guards"
import {
  isNotificationSoundEvent,
  normalizeActionRequest,
  normalizeLibraryDownloadRequest,
  normalizeLibraryExportRequest,
  normalizeLibraryImportRequest,
  normalizeLibraryMetaPatch,
  normalizeLibraryThumbnailSaveRequest,
  normalizeProjectDraftSaveRequest,
  normalizeSaveReplayClipRequest,
} from "./ipc-normalizers"
import { probeServer } from "./probe"
import {
  configureRecordingBackend,
  emitRecordingSettingsEvent,
  getRecordingStatus,
  getRecordingStorageInfo,
  addRecordingBookmark,
  listGameProcesses,
  listRecordingDisplays,
  onRecordingEvent,
  resolveRevealableCapturePath,
  saveReplayClip,
  stopRecording,
  stopRecordingAudioLevels,
  subscribeRecordingAudioLevels,
  takeRecordingScreenshot,
  toggleLongRecording,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  deleteRecordingLibraryItem,
  getRecordingLibrarySnapshot,
  exportRecordingLibraryItem,
  importRecordingLibraryCapture,
  openRecordingLibraryFolder,
  openRecordingLibraryItem,
  revealRecordingLibraryItem,
  deleteRecordingLibraryProjectDraft,
  saveRecordingLibraryProjectDraft,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library"
import {
  cancelRecordingLibraryClipDownload,
  listRecordingLibraryClipDownloads,
  startRecordingLibraryClipDownload,
} from "./recording-library-download"
import { storeRecordingThumbnail } from "./recording-library-thumbnails"
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
import { sameOrigin } from "./url-policy"
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
}

function registerRecordingLibraryIpc(windows: Windows): void {
  ipcMain.handle(IPC.getRecordingLibrary, (event) => {
    requireMainSender(windows, event)
    return getRecordingLibrarySnapshot()
  })
  ipcMain.handle(IPC.openRecordingLibraryFolder, (event) => {
    requireMainSender(windows, event)
    openRecordingLibraryFolder()
  })
  ipcMain.handle(IPC.openRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") openRecordingLibraryItem(id)
  })
  ipcMain.handle(IPC.revealRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") revealRecordingLibraryItem(id)
  })
  ipcMain.handle(
    IPC.exportRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      return exportRecordingLibraryItem(normalizeLibraryExportRequest(request))
    },
  )
  ipcMain.handle(
    IPC.updateRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const patch = normalizeLibraryMetaPatch(request)
      if (patch) updateRecordingLibraryCaptureMeta(patch)
    },
  )
  ipcMain.handle(
    IPC.saveRecordingLibraryProjectDraft,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeProjectDraftSaveRequest(request)
      if (!normalized) throw new Error("Invalid project draft request.")
      return saveRecordingLibraryProjectDraft(normalized)
    },
  )
  ipcMain.handle(
    IPC.deleteRecordingLibraryProjectDraft,
    (event, id: unknown) => {
      requireMainSender(windows, event)
      if (typeof id === "string") deleteRecordingLibraryProjectDraft(id)
    },
  )
  ipcMain.handle(IPC.deleteRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") return deleteRecordingLibraryItem(id)
  })
  ipcMain.handle(
    IPC.importRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryImportRequest(request)
      if (!normalized) throw new Error("Invalid render import request.")
      return importRecordingLibraryCapture(normalized)
    },
  )
  ipcMain.handle(
    IPC.saveRecordingLibraryCaptureThumbnail,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryThumbnailSaveRequest(request)
      if (!normalized) throw new Error("Invalid thumbnail save request.")
      storeRecordingThumbnail(normalized.id, normalized.data)
    },
  )
  ipcMain.handle(
    IPC.downloadRecordingLibraryClip,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryDownloadRequest(request)
      if (!normalized) throw new Error("Invalid clip download request.")
      // The fetch runs with the signed-in session's cookies, so only ever
      // send it to the server this window is connected to.
      const serverUrl = windows.currentServerUrl()
      if (!serverUrl || !sameOrigin(normalized.mediaUrl, serverUrl)) {
        throw new Error("Clip downloads must come from the connected server.")
      }
      return startRecordingLibraryClipDownload(normalized)
    },
  )
  ipcMain.handle(
    IPC.cancelRecordingLibraryClipDownload,
    (event, clipId: unknown) => {
      requireMainSender(windows, event)
      if (typeof clipId === "string") {
        cancelRecordingLibraryClipDownload(clipId)
      }
    },
  )
  ipcMain.handle(IPC.listRecordingLibraryClipDownloads, (event) => {
    requireMainSender(windows, event)
    return listRecordingLibraryClipDownloads()
  })
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
      const openError = await shell.openPath(ensureNotificationSoundsDir(sound))
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
  ipcMain.handle(IPC.stopRecordingAudioLevels, async (event) => {
    requireMainSender(windows, event)
    return stopRecordingAudioLevels()
  })
}

function registerRecordingActionIpc(windows: Windows): void {
  ipcMain.handle(IPC.saveReplayClip, (event, request: unknown) => {
    requireMainSender(windows, event)
    return saveReplayClip(normalizeSaveReplayClipRequest(request))
  })
  ipcMain.handle(IPC.addRecordingBookmark, (event, request: unknown) => {
    requireMainSender(windows, event)
    return addRecordingBookmark(normalizeActionRequest(request))
  })
  ipcMain.handle(IPC.takeRecordingScreenshot, (event, request: unknown) => {
    requireMainSender(windows, event)
    return takeRecordingScreenshot(normalizeActionRequest(request))
  })
  ipcMain.handle(IPC.toggleLongRecording, (event, request: unknown) => {
    requireMainSender(windows, event)
    return toggleLongRecording(normalizeActionRequest(request))
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
