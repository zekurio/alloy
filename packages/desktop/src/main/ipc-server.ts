import {
  DESKTOP_AUTH_CAPABILITY_VERSION,
  DESKTOP_HTTP_CONTRACT_1,
  type DesktopConnectResult,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { ipcMain, shell } from "electron"

import {
  OVERLAY_CONTINUE_STARTUP_CHANNEL,
  OVERLAY_GET_STARTUP_SERVER_CHANNEL,
  OVERLAY_GET_STARTUP_UPDATE_CHANNEL,
  OVERLAY_OPEN_RELEASES_CHANNEL,
  OVERLAY_RETRY_STARTUP_UPDATE_CHANNEL,
} from "@/shared/ipc"

import { loginViaBrowser } from "./browser-login"
import type { DesktopApiHandlerFragment } from "./ipc-api"
import {
  requireControllableWindow,
  requireDesktopSender,
  requireDesktopServerStateSender,
  requireMainSender,
  requireOverlaySender,
} from "./ipc-guards"
import { confirmNativeAction } from "./native-confirmation"
import { probeServer } from "./probe"
import {
  parseBoolean,
  parseString,
  parseUntrustedRecord,
  type UntrustedInput,
} from "./runtime-validation"
import { evaluateServerInfoResponse } from "./server-http-contract"
import {
  forgetServer,
  getSavedServers,
  getStartupServerUrl,
  rememberServer,
} from "./server-store"
import { clearServerAuthCookies, hasStoredSession } from "./session"
import {
  continueStartup,
  getStartupUpdateState,
  retryStartupUpdate,
} from "./updater"
import type { Windows } from "./windows"

const SETUP_REQUIRED_ERROR =
  "This Alloy server needs setup. Finish setup in your browser, then connect again."
const SERVER_INFO_PATH = "/api/server-info"
const SERVER_INFO_TIMEOUT_MS = 8000

interface ConnectOptions {
  forceBrowserLogin: boolean
}

/**
 * Overlay-only channels, deliberately outside the main window's native API.
 * The bundled connect screen is the only sender allowed to read startup state.
 */
export function registerOverlayIpc(windows: Windows): void {
  ipcMain.handle(OVERLAY_GET_STARTUP_SERVER_CHANNEL, (event): string | null => {
    requireOverlaySender(windows, event)
    return getStartupServerUrl()
  })
  ipcMain.handle(OVERLAY_GET_STARTUP_UPDATE_CHANNEL, (event) => {
    requireOverlaySender(windows, event)
    return getStartupUpdateState()
  })
  ipcMain.handle(OVERLAY_RETRY_STARTUP_UPDATE_CHANNEL, (event) => {
    requireOverlaySender(windows, event)
    retryStartupUpdate()
  })
  ipcMain.handle(OVERLAY_CONTINUE_STARTUP_CHANNEL, (event) => {
    requireOverlaySender(windows, event)
    continueStartup()
  })
  ipcMain.handle(OVERLAY_OPEN_RELEASES_CHANNEL, async (event) => {
    requireOverlaySender(windows, event)
    await shell.openExternal("https://github.com/zekurio/alloy/releases/latest")
  })
}

/** Server connection, navigation, and window-control native handlers. */
export const serverDesktopApiHandlers = {
  // `servers.connect` serves both the overlay's first connect and the
  // connected app's server switcher, so it takes the wider desktop guard.
  "servers.connect": {
    guard: requireDesktopSender,
    handle: async (
      windows,
      event,
      rawUrl: UntrustedInput,
      options: UntrustedInput,
    ): Promise<DesktopConnectResult> => {
      const url = parseString(rawUrl)
      if (url === null) {
        return { ok: false, error: "Enter a server URL." }
      }
      const forceBrowserLogin = connectOptions(options).forceBrowserLogin
      const currentServerUrl = windows.currentServerUrl()
      const requestedOrigin = URL.canParse(url) ? new URL(url).origin : null
      if (
        currentServerUrl &&
        requestedOrigin !== new URL(currentServerUrl).origin &&
        !(await confirmNativeAction(event, {
          type: "question",
          title: t("Connect to another Alloy server?"),
          message: url.slice(0, 200),
          confirmLabel: t("Continue"),
        }))
      ) {
        return { ok: false, error: t("Server switch cancelled.") }
      }

      // Re-probe after user confirmation so renderer input cannot turn main
      // into a private-network probe.
      const result = await probeServer(url)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.config.setupRequired) {
        await shell
          .openExternal(new URL("/setup", result.serverUrl).toString())
          .catch(() => undefined)
        return { ok: false, error: SETUP_REQUIRED_ERROR }
      }
      // Legacy fallback is allowed only after this exact pre-cut capability
      // has validated. A future auth capability is not contract 1.
      if (
        result.config.desktopAuth.version !== DESKTOP_AUTH_CAPABILITY_VERSION
      ) {
        return {
          ok: false,
          error: "This Alloy server is not compatible with this desktop app.",
        }
      }
      const contract = await checkServerHttpContract(result.serverUrl)
      if (!contract.ok) return { ok: false, error: contract.error }

      // Let the bundled app validate stored credentials through the API proxy.
      // A separate validation request could rotate a refresh token and strand
      // it if interrupted. Browser login is required only when no usable local
      // auth cookie exists.
      if (forceBrowserLogin || !(await hasStoredSession(result.serverUrl))) {
        const login = await loginViaBrowser(result.serverUrl)
        if (!login.ok) return { ok: false, error: login.error }
      }

      rememberServer(result.serverUrl, DESKTOP_HTTP_CONTRACT_1)
      // Resolve IPC before destroying or closing the invoking renderer.
      setTimeout(() => windows.connectTo(result.serverUrl), 0)
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
    handle: async (windows, event, input: UntrustedInput) => {
      const url = parseString(input)
      if (url === null) return getSavedServers()
      const saved = getSavedServers().find((server) => server.serverUrl === url)
      if (!saved) return getSavedServers()
      if (
        !(await confirmNativeAction(event, {
          title: t("Forget Alloy server?"),
          message: new URL(saved.serverUrl).host,
          confirmLabel: t("Forget server"),
        }))
      ) {
        return getSavedServers()
      }

      await clearServerAuthCookies(saved.serverUrl)
      const remaining = forgetServer(saved.serverUrl)
      if (new URL(saved.serverUrl).origin === windows.currentServerUrl()) {
        // Re-open the connect surface instead of selecting another saved
        // server without probing its current HTTP contract.
        setTimeout(() => windows.disconnectFromServer(), 0)
      }
      return remaining
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
} satisfies DesktopApiHandlerFragment

async function checkServerHttpContract(
  serverUrl: string,
): Promise<ReturnType<typeof evaluateServerInfoResponse>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SERVER_INFO_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(SERVER_INFO_PATH, serverUrl), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    })
    const body: unknown = response.ok
      ? await response.json().catch(() => null)
      : null
    return evaluateServerInfoResponse(response.status, body)
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error && cause.name === "AbortError"
          ? t("Connection timed out.")
          : t("Could not reach server."),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function connectOptions(value: UntrustedInput): ConnectOptions {
  const record = parseUntrustedRecord(value)
  return {
    forceBrowserLogin: parseBoolean(record?.forceBrowserLogin) === true,
  }
}
