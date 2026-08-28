import { contextBridge, ipcRenderer } from "electron"

import { desktopApiChannel } from "@/shared/desktop-api"
import type { AlloyNative } from "@/shared/ipc"
import {
  OVERLAY_CONTINUE_STARTUP_CHANNEL,
  OVERLAY_GET_STARTUP_SERVER_CHANNEL,
  OVERLAY_GET_STARTUP_UPDATE_CHANNEL,
  OVERLAY_OPEN_RELEASES_CHANNEL,
  OVERLAY_RETRY_STARTUP_UPDATE_CHANNEL,
  OVERLAY_STARTUP_UPDATE_EVENT_CHANNEL,
} from "@/shared/ipc"

/**
 * Native API exposed only in the overlay window. It forwards to fixed IPC
 * channels; raw `ipcRenderer` never reaches the renderer.
 */
const alloyNative: AlloyNative = {
  connect: (url, options) =>
    ipcRenderer.invoke(desktopApiChannel("servers.connect"), url, options),
  getStartupServer: () =>
    ipcRenderer.invoke(OVERLAY_GET_STARTUP_SERVER_CHANNEL),
  getStartupUpdate: () =>
    ipcRenderer.invoke(OVERLAY_GET_STARTUP_UPDATE_CHANNEL),
  retryStartupUpdate: () =>
    ipcRenderer.invoke(OVERLAY_RETRY_STARTUP_UPDATE_CHANNEL),
  continueStartup: () => ipcRenderer.invoke(OVERLAY_CONTINUE_STARTUP_CHANNEL),
  openReleases: () => ipcRenderer.invoke(OVERLAY_OPEN_RELEASES_CHANNEL),
  onStartupUpdate: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof listener>[0],
    ) => listener(state)
    ipcRenderer.on(OVERLAY_STARTUP_UPDATE_EVENT_CHANNEL, handler)
    return () => ipcRenderer.off(OVERLAY_STARTUP_UPDATE_EVENT_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld("alloyNative", alloyNative)
