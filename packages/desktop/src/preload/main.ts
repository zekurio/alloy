import { contextBridge, ipcRenderer } from "electron"

import type {
  AlloyDesktopMarker,
  AlloyDesktopRecordingApi,
  AlloyDesktopServerApi,
} from "../shared/ipc"
import { IPC } from "../shared/ipc"

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
  onEvent: (listener) => {
    const handler = (_event: unknown, event: unknown) => {
      listener(event as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(IPC.recordingEvent, handler)
    return () => ipcRenderer.off(IPC.recordingEvent, handler)
  },
  selectOutputFolder: () => ipcRenderer.invoke(IPC.selectOutputFolder),
  selectNotificationSound: (sound) =>
    ipcRenderer.invoke(IPC.selectNotificationSound, sound),
  listGameProcesses: () => ipcRenderer.invoke(IPC.listGameProcesses),
  saveReplayClip: () => ipcRenderer.invoke(IPC.saveReplayClip),
  stopRecording: () => ipcRenderer.invoke(IPC.stopRecording),
  revealCapture: (filename) =>
    ipcRenderer.invoke(IPC.revealRecordingCapture, filename),
}

const marker: AlloyDesktopMarker = {
  platform: process.platform,
  // The main window uses the native OS frame, so the web app should not enable
  // Windows Controls Overlay header compensation.
  titlebarOverlay: false,
  openSettings: () => ipcRenderer.invoke(IPC.openSettings),
  servers,
  recording,
}

contextBridge.exposeInMainWorld("alloyDesktop", marker)
