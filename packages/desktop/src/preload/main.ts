import { contextBridge, ipcRenderer } from "electron"

import type {
  AlloyDesktopMarker,
  AlloyDesktopRecordingApi,
  AlloyDesktopServerApi,
  AlloyDesktopUpdatesApi,
} from "@/shared/ipc"
import { IPC } from "@/shared/ipc"

/**
 * Desktop bridge injected into the main window, which loads the configured
 * Alloy web app. The normal settings dialog lives in that app, so expose the
 * narrow desktop APIs it needs through explicit request/response IPC methods.
 */
const servers: AlloyDesktopServerApi = {
  connect: (url) => ipcRenderer.invoke(IPC.connect, url),
  getServers: () => ipcRenderer.invoke(IPC.getServers),
  getCurrentServer: () => ipcRenderer.invoke(IPC.getCurrentServer),
  forgetServer: (url) => ipcRenderer.invoke(IPC.forgetServer, url),
}

const recording: AlloyDesktopRecordingApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getRecordingSettings),
  setSettings: (settings) =>
    ipcRenderer.invoke(IPC.setRecordingSettings, settings),
  getStatus: () => ipcRenderer.invoke(IPC.getRecordingStatus),
  getStorageInfo: () => ipcRenderer.invoke(IPC.getRecordingStorageInfo),
  getLibrary: () => ipcRenderer.invoke(IPC.getRecordingLibrary),
  openLibraryFolder: () => ipcRenderer.invoke(IPC.openRecordingLibraryFolder),
  openLibraryCapture: (id) =>
    ipcRenderer.invoke(IPC.openRecordingLibraryCapture, id),
  revealLibraryCapture: (id) =>
    ipcRenderer.invoke(IPC.revealRecordingLibraryCapture, id),
  exportLibraryCapture: (request) =>
    ipcRenderer.invoke(IPC.exportRecordingLibraryCapture, request),
  updateLibraryCapture: (patch) =>
    ipcRenderer.invoke(IPC.updateRecordingLibraryCapture, patch),
  saveLibraryProjectDraft: (request) =>
    ipcRenderer.invoke(IPC.saveRecordingLibraryProjectDraft, request),
  deleteLibraryProjectDraft: (id) =>
    ipcRenderer.invoke(IPC.deleteRecordingLibraryProjectDraft, id),
  deleteLibraryCapture: (id) =>
    ipcRenderer.invoke(IPC.deleteRecordingLibraryCapture, id),
  importLibraryCapture: (request) =>
    ipcRenderer.invoke(IPC.importRecordingLibraryCapture, request),
  importLibraryFiles: () => ipcRenderer.invoke(IPC.importRecordingLibraryFiles),
  saveLibraryCaptureThumbnail: (id, data) =>
    ipcRenderer.invoke(IPC.saveRecordingLibraryCaptureThumbnail, { id, data }),
  downloadClip: (request) =>
    ipcRenderer.invoke(IPC.downloadRecordingLibraryClip, request),
  cancelClipDownload: (clipId) =>
    ipcRenderer.invoke(IPC.cancelRecordingLibraryClipDownload, clipId),
  listClipDownloads: () =>
    ipcRenderer.invoke(IPC.listRecordingLibraryClipDownloads),
  getSync: () => ipcRenderer.invoke(IPC.getRecordingLibrarySync),
  pauseSync: () => ipcRenderer.invoke(IPC.pauseRecordingLibrarySync),
  resumeSync: () => ipcRenderer.invoke(IPC.resumeRecordingLibrarySync),
  cancelSyncItem: (captureId) =>
    ipcRenderer.invoke(IPC.cancelRecordingLibrarySyncItem, captureId),
  retrySyncItem: (captureId) =>
    ipcRenderer.invoke(IPC.retryRecordingLibrarySyncItem, captureId),
  queueSyncItem: (captureId) =>
    ipcRenderer.invoke(IPC.queueRecordingLibrarySyncItem, captureId),
  onEvent: (listener) => {
    const handler = (_event: unknown, event: unknown) => {
      listener(event as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(IPC.recordingEvent, handler)
    return () => ipcRenderer.off(IPC.recordingEvent, handler)
  },
  selectOutputFolder: () => ipcRenderer.invoke(IPC.selectOutputFolder),
  listNotificationSounds: () => ipcRenderer.invoke(IPC.listNotificationSounds),
  openNotificationSoundsFolder: (sound) =>
    ipcRenderer.invoke(IPC.openNotificationSoundsFolder, sound),
  previewNotificationSound: (sound) =>
    ipcRenderer.invoke(IPC.previewNotificationSound, sound),
  listGameProcesses: () => ipcRenderer.invoke(IPC.listGameProcesses),
  listDisplays: () => ipcRenderer.invoke(IPC.listRecordingDisplays),
  subscribeAudioLevels: () =>
    ipcRenderer.invoke(IPC.subscribeRecordingAudioLevels),
  stopAudioLevels: () => ipcRenderer.invoke(IPC.stopRecordingAudioLevels),
  saveReplayClip: (request) => ipcRenderer.invoke(IPC.saveReplayClip, request),
  addBookmark: (request) =>
    ipcRenderer.invoke(IPC.addRecordingBookmark, request),
  takeScreenshot: (request) =>
    ipcRenderer.invoke(IPC.takeRecordingScreenshot, request),
  toggleLongRecording: (request) =>
    ipcRenderer.invoke(IPC.toggleLongRecording, request),
  stopRecording: () => ipcRenderer.invoke(IPC.stopRecording),
  revealCapture: (filename) =>
    ipcRenderer.invoke(IPC.revealRecordingCapture, filename),
}

const updates: AlloyDesktopUpdatesApi = {
  getState: () => ipcRenderer.invoke(IPC.getUpdateState),
  restartToInstall: () => ipcRenderer.invoke(IPC.restartToInstallUpdate),
  onState: (listener) => {
    const handler = (_event: unknown, state: unknown) => {
      listener(state as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(IPC.updateEvent, handler)
    return () => ipcRenderer.off(IPC.updateEvent, handler)
  },
}

const marker: AlloyDesktopMarker = {
  platform: process.platform,
  // The main window is frameless; the web app header provides the draggable
  // title bar and custom window controls.
  titlebarOverlay: true,
  minimizeWindow: () => ipcRenderer.invoke(IPC.minimizeWindow),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.toggleMaximizeWindow),
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  openConnect: () => ipcRenderer.invoke(IPC.openConnect),
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  openSettings: () => ipcRenderer.invoke(IPC.openSettings),
  servers,
  recording,
  updates,
}

contextBridge.exposeInMainWorld("alloyDesktop", marker)
