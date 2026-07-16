import { desktopBridgeChannel } from "@alloy/contracts"
import { contextBridge, ipcRenderer } from "electron"

import type { AlloyNative } from "@/shared/ipc"
import { OVERLAY_GET_STARTUP_SERVER_CHANNEL } from "@/shared/ipc"

/**
 * The single privileged bridge, exposed only in the overlay window. It forwards
 * to request/response IPC channels — no raw `ipcRenderer` reaches the renderer,
 * so the attack surface is exactly the methods below.
 */
const alloyNative: AlloyNative = {
  connect: (url, options) =>
    ipcRenderer.invoke(desktopBridgeChannel("servers.connect"), url, options),
  getStartupServer: () =>
    ipcRenderer.invoke(OVERLAY_GET_STARTUP_SERVER_CHANNEL),
}

contextBridge.exposeInMainWorld("alloyNative", alloyNative)
