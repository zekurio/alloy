import { ipcMain, shell } from "electron"

import type { ConnectResult, ProbeResult } from "@/shared/ipc"
import { IPC } from "@/shared/ipc"

import { loginViaBrowser } from "./browser-login"
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

export function registerServerIpc(windows: Windows): void {
  registerServerConnectionIpc(windows)
  registerServerNavigationIpc(windows)
  registerServerStateIpc(windows)
  registerServerWindowControlIpc(windows)
}

function registerServerConnectionIpc(windows: Windows): void {
  ipcMain.handle(IPC.probe, (event, url: unknown): Promise<ProbeResult> => {
    requireOverlaySender(windows, event)
    if (typeof url !== "string") {
      return Promise.resolve({ ok: false, error: "Enter a server URL." })
    }
    return probeServer(url)
  })

  ipcMain.handle(
    IPC.connect,
    async (event, url: unknown, options: unknown): Promise<ConnectResult> => {
      requireDesktopSender(windows, event)
      if (typeof url !== "string") {
        return { ok: false, error: "Enter a server URL." }
      }
      const forceBrowserLogin = connectOptions(options).forceBrowserLogin
      // Re-probe before committing so we only ever persist + load a URL we just
      // confirmed is a reachable Alloy server.
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
  )
}

function registerServerNavigationIpc(windows: Windows): void {
  ipcMain.handle(IPC.openConnect, (event) => {
    requireDesktopSender(windows, event)
    windows.openConnect()
  })
  ipcMain.handle(IPC.openLibrary, (event) => {
    requireMainSender(windows, event)
    windows.openLibrary()
  })
}

function registerServerWindowControlIpc(windows: Windows): void {
  ipcMain.handle(IPC.openSettings, (event) => {
    requireDesktopSender(windows, event)
    windows.openSettings()
  })
  ipcMain.handle(IPC.minimizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.minimize()
  })
  ipcMain.handle(IPC.toggleMaximizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    if (window.isMaximized()) {
      window.unmaximize()
      return
    }
    window.maximize()
  })
  ipcMain.handle(IPC.closeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.close()
  })
}

function registerServerStateIpc(windows: Windows): void {
  ipcMain.handle(IPC.getStartupServer, (event): string | null => {
    requireOverlaySender(windows, event)
    return getStartupServerUrl()
  })
  ipcMain.handle(IPC.getServers, (event) => {
    requireDesktopServerStateSender(windows, event)
    return getSavedServers()
  })
  ipcMain.handle(IPC.getCurrentServer, (event) => {
    requireDesktopServerStateSender(windows, event)
    return windows.currentServerUrl()
  })
  ipcMain.handle(IPC.forgetServer, (event, url: unknown) => {
    requireDesktopSender(windows, event)
    if (typeof url !== "string") return getSavedServers()
    return forgetServer(url)
  })
}

function connectOptions(value: unknown): { forceBrowserLogin: boolean } {
  if (!value || typeof value !== "object") return { forceBrowserLogin: false }
  return {
    forceBrowserLogin:
      (value as { forceBrowserLogin?: unknown }).forceBrowserLogin === true,
  }
}
