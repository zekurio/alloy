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

/**
 * Desktop bridge injected into the main window, which loads the configured
 * Alloy web app. The runtime shape is generated from the `DESKTOP_BRIDGE`
 * contract metadata: every invokable member forwards to its derived IPC
 * channel, every event member subscribes to it, so preload and contract
 * cannot drift.
 */

const APP_VERSION_ARG_PREFIX = "--alloy-app-version="

function isMethodMeta(value: unknown): value is DesktopBridgeMethodMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "since" in value &&
    typeof value.since === "number"
  )
}

function buildBridgeApi(
  tree: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const api: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = (prefix ? `${prefix}.${key}` : key) as DesktopBridgePath
    if (!isMethodMeta(value)) {
      api[key] = buildBridgeApi(value as Record<string, unknown>, path)
      continue
    }
    const channel = desktopBridgeChannel(path)
    if (value.event) {
      api[key] = (listener: (payload: unknown) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          listener(payload)
        }
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.off(channel, handler)
      }
      continue
    }
    api[key] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  }
  return api
}

// The generated record mirrors the contract tree by construction; the cast
// names the shape the walk produces from `DESKTOP_BRIDGE`.
const api = buildBridgeApi(DESKTOP_BRIDGE, "") as Omit<
  AlloyDesktop,
  "bridge" | "titlebarOverlay"
>

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
