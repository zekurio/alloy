import type {
  AlloyDesktop,
  DesktopBridgeMethodMeta,
  DesktopBridgePath,
} from "@alloy/contracts"
import {
  DESKTOP_BRIDGE,
  DESKTOP_BRIDGE_VERSION,
  desktopBridgeChannel,
} from "@alloy/contracts"
import { contextBridge, ipcRenderer } from "electron"

type BridgeTree = {
  readonly [key: string]: DesktopBridgeMethodMeta | BridgeTree
}

type BridgeArgument = Parameters<typeof ipcRenderer.invoke>[1]
type BridgeEventPayload = Parameters<Parameters<typeof ipcRenderer.on>[1]>[1]
type BridgeApiValue =
  | ((...args: BridgeArgument[]) => Promise<BridgeEventPayload>)
  | ((listener: (payload: BridgeEventPayload) => void) => () => void)
  | BridgeApiTree
type BridgeApiTree = { [key: string]: BridgeApiValue }

/**
 * Desktop bridge injected into the main window, which loads the configured
 * Alloy web app. The runtime shape is generated from the `DESKTOP_BRIDGE`
 * contract metadata: every invokable member forwards to its derived IPC
 * channel, every event member subscribes to it, so preload and contract
 * cannot drift.
 */

const APP_VERSION_ARG_PREFIX = "--alloy-app-version="

function buildBridgeApi(
  tree: typeof DESKTOP_BRIDGE,
  prefix: "",
): Omit<AlloyDesktop, "bridge" | "titlebarOverlay">
function buildBridgeApi(tree: BridgeTree, prefix: string): BridgeApiTree
function buildBridgeApi(
  tree: BridgeTree,
  prefix: string,
): BridgeApiTree | Omit<AlloyDesktop, "bridge" | "titlebarOverlay"> {
  const api: BridgeApiTree = {}
  for (const [key, value] of Object.entries(tree)) {
    // SAFETY: Each prefix and key comes from the closed DESKTOP_BRIDGE tree.
    const path = (prefix ? `${prefix}.${key}` : key) as DesktopBridgePath
    if (!("since" in value)) {
      api[key] = buildBridgeApi(value, path)
      continue
    }
    const channel = desktopBridgeChannel(path)
    if (value.event) {
      api[key] = (listener: (payload: BridgeEventPayload) => void) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          payload: BridgeEventPayload,
        ) => {
          listener(payload)
        }
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.off(channel, handler)
      }
      continue
    }
    api[key] = (...args: BridgeArgument[]) =>
      ipcRenderer.invoke(channel, ...args)
  }
  return api
}

const api = buildBridgeApi(DESKTOP_BRIDGE, "")

// The main process injects the app version through `additionalArguments`;
// preload cannot call `app.getVersion()` directly.
const versionArg = process.argv.find((entry) =>
  entry.startsWith(APP_VERSION_ARG_PREFIX),
)
const alloyDesktop: AlloyDesktop = {
  ...api,
  // The main window is frameless; the web app header provides the draggable
  // title bar and custom window controls.
  titlebarOverlay: true,
  bridge: {
    version: DESKTOP_BRIDGE_VERSION,
    appVersion: versionArg
      ? versionArg.slice(APP_VERSION_ARG_PREFIX.length)
      : "",
  },
}

contextBridge.exposeInMainWorld("alloyDesktop", alloyDesktop)
