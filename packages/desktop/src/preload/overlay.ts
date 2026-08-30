import { contextBridge, ipcRenderer } from "electron"

import { desktopApiChannel } from "@/shared/desktop-api"
import type { AlloyNative } from "@/shared/ipc"
import { OVERLAY_GET_STARTUP_SERVER_CHANNEL } from "@/shared/ipc"

/**
 * Native API exposed only in the overlay window. It forwards to fixed IPC
 * channels; raw `ipcRenderer` never reaches the renderer.
 */
const alloyNative: AlloyNative = {
  connect: (url, options) =>
    ipcRenderer.invoke(desktopApiChannel("servers.connect"), url, options),
  getStartupServer: () =>
    ipcRenderer.invoke(OVERLAY_GET_STARTUP_SERVER_CHANNEL),
}

contextBridge.exposeInMainWorld("alloyNative", alloyNative)
