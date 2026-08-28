import type { AlloyDesktop } from "@alloy/contracts"
import { contextBridge, ipcRenderer } from "electron"

import {
  DESKTOP_API_OPERATIONS,
  desktopApiChannel,
  type DesktopApiOperationMeta,
  type DesktopApiPath,
} from "@/shared/desktop-api"

type DesktopApiTree = {
  readonly [key: string]: DesktopApiOperationMeta | DesktopApiTree
}

type DesktopApiArgument = Parameters<typeof ipcRenderer.invoke>[1]
type DesktopApiEventPayload = Parameters<
  Parameters<typeof ipcRenderer.on>[1]
>[1]
type DesktopApiValue =
  | ((...args: DesktopApiArgument[]) => Promise<DesktopApiEventPayload>)
  | ((listener: (payload: DesktopApiEventPayload) => void) => () => void)
  | DesktopApiObject
type DesktopApiObject = { [key: string]: DesktopApiValue }

/**
 * Desktop API injected into the bundled renderer. The runtime shape comes
 * from `DESKTOP_API_OPERATIONS`: invokes use private IPC channels and events
 * subscribe to those channels, so preload and handlers cannot drift.
 */
function buildDesktopApi(
  tree: typeof DESKTOP_API_OPERATIONS,
  prefix: "",
): Omit<AlloyDesktop, "titlebarOverlay">
function buildDesktopApi(tree: DesktopApiTree, prefix: string): DesktopApiObject
function buildDesktopApi(
  tree: DesktopApiTree,
  prefix: string,
): DesktopApiObject | Omit<AlloyDesktop, "titlebarOverlay"> {
  const api: DesktopApiObject = {}
  for (const [key, value] of Object.entries(tree)) {
    // SAFETY: Prefixes and keys come from DESKTOP_API_OPERATIONS.
    const path = (prefix ? `${prefix}.${key}` : key) as DesktopApiPath
    if (!("kind" in value)) {
      api[key] = buildDesktopApi(value, path)
      continue
    }
    const channel = desktopApiChannel(path)
    if (value.kind === "event") {
      api[key] = (listener: (payload: DesktopApiEventPayload) => void) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          payload: DesktopApiEventPayload,
        ) => {
          listener(payload)
        }
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.off(channel, handler)
      }
      continue
    }
    api[key] = (...args: DesktopApiArgument[]) =>
      ipcRenderer.invoke(channel, ...args)
  }
  return api
}

const api = buildDesktopApi(DESKTOP_API_OPERATIONS, "")

const alloyDesktop: AlloyDesktop = {
  ...api,
  // The main window is frameless; the app header provides the draggable title
  // bar and custom window controls.
  titlebarOverlay: true,
}

contextBridge.exposeInMainWorld("alloyDesktop", alloyDesktop)
