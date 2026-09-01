import { normalizeRecordingSettings } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"

import { desktopApiChannel } from "@/shared/desktop-api"

import { getAutostartState, setAutostartEnabled } from "./autostart"
import { showDesktopNotification } from "./desktop-notification"
import type {
  DesktopApiHandlerFragment,
  DesktopApiHandlerMap,
  DesktopApiInvokePath,
} from "./ipc-api"
import { requireDesktopSender, requireMainSender } from "./ipc-guards"
import { isNotificationSoundEvent } from "./ipc-normalizers"
import { recordingLibraryDesktopApiHandlers } from "./ipc-recording-library"
import { registerOverlayIpc, serverDesktopApiHandlers } from "./ipc-server"
import {
  configureRecordingBackend,
  emitRecordingSettingsEvent,
  getRecordingStatus,
  getRecordingStorageInfo,
  listGameProcesses,
  listRecordingDisplays,
  onRecordingEvent,
  restartRecordingBackend,
  stopAudioLevels,
  subscribeRecordingAudioLevels,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  ensureNotificationSoundsDir,
  listNotificationSoundLibrary,
  playRecordingNotificationSound,
} from "./recording-notification-sounds"
import { parseBoolean, type UntrustedInput } from "./runtime-validation"
import { getRecordingSettings, saveRecordingSettings } from "./server-store"
import {
  checkForUpdatesNow,
  downloadUpdateNow,
  getUpdateState,
  onUpdateStateChange,
  restartToInstallUpdate,
} from "./updater"
import type { Windows } from "./windows"

/**
 * Register the server renderer's privileged native API. The merged handler
 * map is exhaustive over `DESKTOP_API_OPERATIONS`, so preload and main cannot
 * drift. Handlers are intentionally thin: validate input, mutate persisted
 * state, and drive windows. Invoke channels use request/response (`handle`);
 * event operations are broadcasts registered in {@link registerDesktopApiEvents}.
 */
export function registerDesktopApi(windows: Windows): void {
  registerDesktopApiEvents()
  registerOverlayIpc(windows)

  const handlers: DesktopApiHandlerMap = {
    ...serverDesktopApiHandlers,
    ...recordingSettingsDesktopApiHandlers,
    ...recordingStorageDesktopApiHandlers,
    ...recordingLibraryDesktopApiHandlers,
    ...recordingSoundDesktopApiHandlers,
    ...recordingSourceDesktopApiHandlers,
    ...updateDesktopApiHandlers,
    ...autostartDesktopApiHandlers,
    ...notificationDesktopApiHandlers,
  }
  // SAFETY: The exhaustive handler map is a closed record over these paths.
  const paths = Object.keys(handlers) as DesktopApiInvokePath[]
  for (const path of paths) {
    const { guard, handle } = handlers[path]
    ipcMain.handle(desktopApiChannel(path), (event, ...args: unknown[]) => {
      guard(windows, event)
      return handle(windows, event, ...args)
    })
  }
}

/** Event operations pushed to every live window, with no invoke handler. */
function registerDesktopApiEvents(): void {
  const recordingEventChannel = desktopApiChannel("recording.onEvent")
  onRecordingEvent((recordingEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(recordingEventChannel, recordingEvent)
      }
    }
  })
  const updateStateChannel = desktopApiChannel("updates.onState")
  onUpdateStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(updateStateChannel, state)
      }
    }
  })
}

const updateDesktopApiHandlers = {
  "updates.getState": {
    guard: requireDesktopSender,
    handle: () => getUpdateState(),
  },
  "updates.checkForUpdates": {
    guard: requireDesktopSender,
    handle: () => checkForUpdatesNow(),
  },
  "updates.downloadUpdate": {
    guard: requireDesktopSender,
    handle: () => downloadUpdateNow(),
  },
  "updates.restartToInstall": {
    guard: requireDesktopSender,
    handle: () => {
      restartToInstallUpdate()
    },
  },
} satisfies DesktopApiHandlerFragment

const autostartDesktopApiHandlers = {
  "autostart.getState": {
    guard: requireMainSender,
    handle: () => getAutostartState(),
  },
  "autostart.setEnabled": {
    guard: requireMainSender,
    handle: (_windows, _event, enabled: UntrustedInput) =>
      setAutostartEnabled(parseBoolean(enabled) === true),
  },
} satisfies DesktopApiHandlerFragment

const notificationDesktopApiHandlers = {
  "notifications.show": {
    guard: requireMainSender,
    handle: (windows, _event, input: UntrustedInput) => {
      showDesktopNotification(windows, input)
    },
  },
} satisfies DesktopApiHandlerFragment

const recordingSettingsDesktopApiHandlers = {
  "recording.getSettings": {
    guard: requireMainSender,
    handle: () => getRecordingSettings(),
  },
  "recording.setSettings": {
    guard: requireMainSender,
    handle: (_windows, _event, settings: UntrustedInput) => {
      const saved = saveRecordingSettings(normalizeRecordingSettings(settings))
      emitRecordingSettingsEvent()
      void configureRecordingBackend()
      configureRecordingHotkeys(saved)
      return saved
    },
  },
  "recording.restartBackend": {
    guard: requireMainSender,
    handle: () => restartRecordingBackend(),
  },
  "recording.getStatus": {
    guard: requireMainSender,
    handle: () => getRecordingStatus(),
  },
} satisfies DesktopApiHandlerFragment

const recordingStorageDesktopApiHandlers = {
  "recording.getStorageInfo": {
    guard: requireMainSender,
    handle: () => getRecordingStorageInfo(),
  },
  "recording.selectOutputFolder": {
    guard: requireMainSender,
    handle: async (_windows, event): Promise<string | null> => {
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
  },
} satisfies DesktopApiHandlerFragment

const recordingSoundDesktopApiHandlers = {
  "recording.listNotificationSounds": {
    guard: requireMainSender,
    handle: () => listNotificationSoundLibrary(),
  },
  "recording.openNotificationSoundsFolder": {
    guard: requireMainSender,
    handle: async (_windows, _event, sound: UntrustedInput): Promise<void> => {
      if (!isNotificationSoundEvent(sound)) return
      const openError = await shell.openPath(ensureNotificationSoundsDir())
      if (openError) throw new Error(openError)
    },
  },
  "recording.previewNotificationSound": {
    guard: requireMainSender,
    handle: async (_windows, _event, sound: UntrustedInput): Promise<void> => {
      if (!isNotificationSoundEvent(sound)) return
      // Audition the configured sound regardless of whether the event is
      // enabled, so users can hear their pick before turning it on.
      const settings = getRecordingSettings().notificationSounds[sound]
      await playRecordingNotificationSound(sound, {
        ...settings,
        enabled: true,
      })
    },
  },
} satisfies DesktopApiHandlerFragment

const recordingSourceDesktopApiHandlers = {
  "recording.listGameProcesses": {
    guard: requireMainSender,
    handle: () => listGameProcesses(),
  },
  "recording.listDisplays": {
    guard: requireMainSender,
    handle: () => listRecordingDisplays(),
  },
  "recording.subscribeAudioLevels": {
    guard: requireMainSender,
    handle: () => subscribeRecordingAudioLevels(),
  },
  "recording.stopAudioLevels": {
    guard: requireMainSender,
    handle: () => stopAudioLevels(),
  },
} satisfies DesktopApiHandlerFragment
