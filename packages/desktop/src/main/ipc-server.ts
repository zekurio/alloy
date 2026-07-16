import type { DesktopConnectResult } from "@alloy/contracts"
import { ipcMain, shell } from "electron"

import { OVERLAY_GET_STARTUP_SERVER_CHANNEL } from "@/shared/ipc"

import { loginViaBrowser } from "./browser-login"
import type { BridgeHandlerFragment } from "./ipc-bridge"
import {
  requireControllableWindow,
  requireDesktopSender,
  requireDesktopServerStateSender,
  requireMainSender,
  requireOverlaySender,
} from "./ipc-guards"
import { probeServer } from "./probe"
import {
  forgetServer,
  getSavedServers,
  getStartupServerUrl,
  rememberServer,
} from "./server-store"
import { clearRemoteWebCache, hasStoredSession } from "./session"
import type { Windows } from "./windows"

const SETUP_REQUIRED_ERROR =
  "This Alloy server needs setup. Finish setup in your browser, then connect again."

/**
 * Overlay-only channels, deliberately outside the web bridge contract. The
 * bundled connect screen is the only sender allowed to read the startup
 * server.
 */
export function registerOverlayIpc(windows: Windows): void {
  ipcMain.handle(OVERLAY_GET_STARTUP_SERVER_CHANNEL, (event): string | null => {
    requireOverlaySender(windows, event)
    return getStartupServerUrl()
  })
}

/** Server connection, navigation, and window-control bridge handlers. */
export const serverBridgeHandlers = {
  // `servers.connect` serves both the overlay's first connect and the
  // connected app's server switcher, so it takes the wider desktop guard.
  "servers.connect": {
    guard: requireDesktopSender,
    handle: async (
      windows,
      _event,
      url: unknown,
      options: unknown,
    ): Promise<DesktopConnectResult> => {
      if (typeof url !== "string") {
        return { ok: false, error: "Enter a server URL." }
      }
      const forceBrowserLogin = connectOptions(options).forceBrowserLogin
      // Re-probe before committing so we only ever persist + load a URL we
      // just confirmed is a reachable Alloy server.
      const result = await probeServer(url)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.config.setupRequired) {
        await shell
          .openExternal(new URL("/setup", result.serverUrl).toString())
          .catch(() => undefined)
        return { ok: false, error: SETUP_REQUIRED_ERROR }
      }

      // Let the server and web app validate stored credentials during normal
      // navigation. A separate validation request could rotate a refresh token
      // and strand it if the request is interrupted. Browser login is only
      // required when no usable local auth cookie exists.
      if (forceBrowserLogin || !(await hasStoredSession(result.serverUrl))) {
        const login = await loginViaBrowser(result.serverUrl)
        if (!login.ok) return { ok: false, error: login.error }
      }

      rememberServer(result.serverUrl)
      await clearRemoteWebCache()
      windows.connectTo(result.serverUrl)
      return { ok: true, serverUrl: result.serverUrl }
    },
  },
  "servers.getServers": {
    guard: requireDesktopServerStateSender,
    handle: () => getSavedServers(),
  },
  "servers.getCurrentServer": {
    guard: requireDesktopServerStateSender,
    handle: (windows) => windows.currentServerUrl(),
  },
  "servers.forgetServer": {
    guard: requireDesktopSender,
    handle: (_windows, _event, url: unknown) => {
      if (typeof url !== "string") return getSavedServers()
      return forgetServer(url)
    },
  },
  openConnect: {
    guard: requireDesktopSender,
    handle: (windows) => {
      windows.openConnect()
    },
  },
  openSettings: {
    guard: requireDesktopSender,
    handle: (windows) => {
      windows.openSettings()
    },
  },
  reloadApp: {
    guard: requireMainSender,
    handle: (windows, event) => {
      const window = requireControllableWindow(windows, event)
      setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.reloadIgnoringCache()
      }, 0)
    },
  },
  minimizeWindow: {
    guard: requireMainSender,
    handle: (windows, event) => {
      requireControllableWindow(windows, event).minimize()
    },
  },
  toggleMaximizeWindow: {
    guard: requireMainSender,
    handle: (windows, event) => {
      const window = requireControllableWindow(windows, event)
      if (window.isMaximized()) {
        window.unmaximize()
        return
      }
      window.maximize()
    },
  },
  closeWindow: {
    guard: requireMainSender,
    handle: (windows, event) => {
      requireControllableWindow(windows, event).close()
    },
  },
} satisfies BridgeHandlerFragment

function connectOptions(value: unknown): { forceBrowserLogin: boolean } {
  if (!value || typeof value !== "object") return { forceBrowserLogin: false }
  return {
    forceBrowserLogin:
      "forceBrowserLogin" in value && value.forceBrowserLogin === true,
  }
}
