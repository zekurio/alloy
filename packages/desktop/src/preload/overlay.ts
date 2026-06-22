import { contextBridge, ipcRenderer } from "electron"

import type { AlloyNative } from "@/shared/ipc"
import { IPC } from "@/shared/ipc"

/**
 * The single privileged bridge, exposed only in the overlay window. It forwards
 * to request/response IPC channels — no raw `ipcRenderer` reaches the renderer,
 * so the attack surface is exactly the methods below.
 */
const alloyNative: AlloyNative = {
  probe: (url) => ipcRenderer.invoke(IPC.probe, url),
  connect: (url, options) => ipcRenderer.invoke(IPC.connect, url, options),
  getStartupServer: () => ipcRenderer.invoke(IPC.getStartupServer),
  getServers: () => ipcRenderer.invoke(IPC.getServers),
  forgetServer: (url) => ipcRenderer.invoke(IPC.forgetServer, url),
}

contextBridge.exposeInMainWorld("alloyNative", alloyNative)
