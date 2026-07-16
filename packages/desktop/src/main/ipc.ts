import {
  desktopBridgeChannel,
  normalizeRecordingSettings,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"

import { getAutostartState, setAutostartEnabled } from "./autostart"
import { showDesktopNotification } from "./desktop-notification"
import type {
  BridgeHandlerFragment,
  BridgeHandlerMap,
  DesktopBridgeInvokePath,
} from "./ipc-bridge"
import { requireDesktopSender, requireMainSender } from "./ipc-guards"
import { isNotificationSoundEvent } from "./ipc-normalizers"
import { recordingLibraryBridgeHandlers } from "./ipc-recording-library"
import { registerOverlayIpc, serverBridgeHandlers } from "./ipc-server"
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
 * Register the desktop bridge's privileged IPC surface. The merged handler
 * map is exhaustive over the invokable `DESKTOP_BRIDGE` contract paths in
 * both directions, so the contract and the main process cannot drift.
 * Handlers are intentionally thin: validate input, mutate persisted state,
 * drive the windows. Every bridge channel is request/response (`handle`) so
 * callers get typed results back; the contract's event members are push
 * broadcasts registered in {@link registerBridgeEvents}.
 */
export function registerBridge(windows: Windows): void {
  registerBridgeEvents()
  registerOverlayIpc(windows)

  const handlers: BridgeHandlerMap = {
    ...serverBridgeHandlers,
    ...recordingSettingsBridgeHandlers,
    ...recordingStorageBridgeHandlers,
    ...recordingLibraryBridgeHandlers,
    ...recordingSoundBridgeHandlers,
    ...recordingSourceBridgeHandlers,
    ...updateBridgeHandlers,
    ...autostartBridgeHandlers,
    ...notificationBridgeHandlers,
  }
  // Object.keys loses the literal key type; the map is a closed Record over
  // exactly these paths.
  const paths = Object.keys(handlers) as DesktopBridgeInvokePath[]
  for (const path of paths) {
    const { guard, handle } = handlers[path]
    ipcMain.handle(desktopBridgeChannel(path), (event, ...args: unknown[]) => {
      guard(windows, event)
      return handle(windows, event, ...args)
    })
  }
}

/** Contract event members: pushed to every live window, no invoke handler. */
function registerBridgeEvents(): void {
  const recordingEventChannel = desktopBridgeChannel("recording.onEvent")
  onRecordingEvent((recordingEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(recordingEventChannel, recordingEvent)
      }
    }
  })
  const updateStateChannel = desktopBridgeChannel("updates.onState")
  onUpdateStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(updateStateChannel, state)
      }
    }
  })
}

const updateBridgeHandlers = {
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
} satisfies BridgeHandlerFragment

const autostartBridgeHandlers = {
  "autostart.getState": {
    guard: requireMainSender,
    handle: () => getAutostartState(),
  },
  "autostart.setEnabled": {
    guard: requireMainSender,
    handle: (_windows, _event, enabled: unknown) =>
      setAutostartEnabled(enabled === true),
  },
} satisfies BridgeHandlerFragment

const notificationBridgeHandlers = {
  "notifications.show": {
    guard: requireMainSender,
    handle: (windows, _event, input: unknown) => {
      showDesktopNotification(windows, input)
    },
  },
} satisfies BridgeHandlerFragment

const recordingSettingsBridgeHandlers = {
  "recording.getSettings": {
    guard: requireMainSender,
    handle: () => getRecordingSettings(),
  },
  "recording.setSettings": {
    guard: requireMainSender,
    handle: (_windows, _event, settings: unknown) => {
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
} satisfies BridgeHandlerFragment

const recordingStorageBridgeHandlers = {
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
} satisfies BridgeHandlerFragment

const recordingSoundBridgeHandlers = {
  "recording.listNotificationSounds": {
    guard: requireMainSender,
    handle: () => listNotificationSoundLibrary(),
  },
  "recording.openNotificationSoundsFolder": {
    guard: requireMainSender,
    handle: async (_windows, _event, sound: unknown): Promise<void> => {
      if (!isNotificationSoundEvent(sound)) return
      const openError = await shell.openPath(ensureNotificationSoundsDir())
      if (openError) throw new Error(openError)
    },
  },
  "recording.previewNotificationSound": {
    guard: requireMainSender,
    handle: async (_windows, _event, sound: unknown): Promise<void> => {
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
} satisfies BridgeHandlerFragment

const recordingSourceBridgeHandlers = {
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
} satisfies BridgeHandlerFragment
