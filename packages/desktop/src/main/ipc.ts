import type { DesktopAutostartState } from "@alloy/contracts/desktop-autostart"
import type { DesktopUpdateState } from "@alloy/contracts/desktop-update"
import { t } from "@alloy/i18n"
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron"

import {
  API_CHANNEL,
  CONNECT_CHANNEL,
  CONNECT_COMMANDS,
  SHELL_CHANNEL,
  SHELL_OPERATIONS,
  type IpcResult,
  type NativeJson,
  type ShellOperation,
} from "../shared/ipc"
import { getAutostartState, setAutostartEnabled } from "./autostart"
import { cancelConnect, connectToServer, forgetSavedServer } from "./connection"
import { clearSessionCookies, sessionCookieHeader } from "./cookies"
import {
  requireConnectSender,
  requireRemoteSender,
  type Host,
  type RemoteSession,
} from "./host"
import { asError, log } from "./log"
import { urlPath } from "./policy"
import { RestartError, type Updates } from "./updater"
import { destroyConnect, showConnect, showPendingConnect } from "./windows"

const INVALID_ARGUMENT = "Invalid native argument."

/** Files the import picker offers. */
const IMPORT_EXTENSIONS = [
  "mp4",
  "mkv",
  "mov",
  "webm",
  "png",
  "jpg",
  "jpeg",
  "webp",
]

function stringArgument(args: readonly NativeJson[], index: number): string {
  const value = args[index]
  if (typeof value !== "string") throw new Error(INVALID_ARGUMENT)
  return value
}

/**
 * Registers a handler whose failures reach the renderer as their message,
 * which the renderer translates. Electron would otherwise prefix it.
 * Arguments pass through JSON first, so fields set to `undefined` are
 * dropped rather than rejected.
 */
function handle(
  channel: string,
  run: (
    event: IpcMainInvokeEvent,
    ...args: NativeJson[]
  ) => Promise<NativeJson | undefined>,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult> => {
    try {
      const jsonArgs: NativeJson[] = JSON.parse(JSON.stringify(args))
      return { ok: true, value: await run(event, ...jsonArgs) }
    } catch (cause) {
      return { ok: false, error: asError(cause).message }
    }
  })
}

export function registerIpc(host: Host, updates: Updates): void {
  handle(CONNECT_CHANNEL, async (event, name, url) => {
    requireConnectSender(host, event)
    const command = CONNECT_COMMANDS.find((known) => known === name)
    if (!command) throw new Error("Unknown native desktop operation.")
    switch (command) {
      case "connectServer": {
        await connectToServer(host, parseUrl(url))
        // The connect screen is destroyed rather than hidden: it is cheap to
        // recreate, and it would otherwise keep a renderer process alive.
        destroyConnect(host)
        return undefined
      }
      case "connectReady":
        // The screen calls this once it has painted, so the window is only
        // shown with content in it. Restoring a saved server keeps it hidden.
        showPendingConnect(host)
        return undefined
      case "cancelConnect":
        await cancelConnect(host)
        return undefined
      case "savedServers":
        return host.preferences.servers()
      case "forgetServer":
        return forgetSavedServer(
          host,
          host.native.normalizeServerOrigin(parseUrl(url)),
          () => requireConnectSender(host, event),
        )
    }
  })

  handle(SHELL_CHANNEL, async (event, name) => {
    const remote = requireRemoteSender(host, event)
    const operation = SHELL_OPERATIONS.find((known) => known === name)
    if (!operation) throw new Error("Unknown native desktop operation.")
    await runShellOperation(host, remote, operation)
    return undefined
  })

  handle(API_CHANNEL, async (event, name, rawArgs) => {
    const remote = requireRemoteSender(host, event)
    const args = rawArgs ?? []
    if (typeof name !== "string" || !Array.isArray(args)) {
      throw new Error(INVALID_ARGUMENT)
    }
    if (name === "servers.switchTo") {
      // A successful switch replaces the calling window, so return without
      // checking it again.
      await connectToServer(host, stringArgument(args, 0))
      return undefined
    }
    const result = await runApiOperation(
      host,
      updates,
      event,
      remote,
      name,
      args,
    )
    // The answer only goes to a window that still shows the selected server.
    requireRemoteSender(host, event)
    return result
  })
}

function parseUrl(url: NativeJson | undefined): string {
  if (typeof url !== "string") throw new Error(INVALID_ARGUMENT)
  return url
}

async function runShellOperation(
  host: Host,
  remote: RemoteSession,
  operation: ShellOperation,
): Promise<void> {
  const { window } = remote
  switch (operation) {
    case "minimizeWindow":
      window.minimize()
      return
    case "toggleMaximizeWindow":
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return
    case "closeWindow":
      // Closing the server window keeps the session, recorder, and media
      // work alive in the tray. Quit from the tray menu ends the app.
      window.hide()
      return
    case "openConnect":
      // Signing out lands on the login page; switching from there must not
      // restore the session that just ended.
      if (urlPath(window.webContents.getURL()) === "/login") {
        await clearSessionCookies(window.webContents.session, remote.origin)
      }
      // The server window stays alive, so closing the connect screen
      // returns to it.
      window.hide()
      showConnect(host)
      return
    case "openLogsFolder": {
      host.native.flushLog()
      const error = await shell.openPath(host.folders.logs)
      if (error) {
        log.warn(`Couldn't open the desktop logs folder. ${error}`)
        throw new Error("Couldn't open the desktop logs folder.")
      }
      return
    }
  }
}

async function runApiOperation(
  host: Host,
  updates: Updates,
  event: IpcMainInvokeEvent,
  remote: RemoteSession,
  operation: string,
  args: NativeJson[],
): Promise<NativeJson | undefined> {
  if (operation.startsWith("recording.")) {
    return runRecordingOperation(host, event, remote, operation, args)
  }
  switch (operation) {
    case "servers.list":
      return host.preferences.servers()
    case "servers.forget": {
      const origin = host.native.normalizeServerOrigin(stringArgument(args, 0))
      // Checked again once the forget holds the connection lock: a switch
      // that finished meanwhile may have selected this server.
      const allowed = () => {
        if (origin === requireRemoteSender(host, event).origin) {
          throw new Error(
            "Switch to another server before forgetting this one.",
          )
        }
      }
      allowed()
      return forgetSavedServer(host, origin, allowed)
    }
    case "updates.getState":
      return updateJson(updates.getState())
    case "updates.checkForUpdates":
      return updateJson(await updates.checkForUpdates())
    case "updates.downloadUpdate":
      return updateJson(await updates.downloadUpdate())
    case "updates.restartToInstall":
      await restartToInstall(host, updates)
      return null
    case "autostart.getState":
      return autostartJson(getAutostartState())
    case "autostart.setEnabled": {
      const enabled = args[0]
      if (typeof enabled !== "boolean") throw new Error(INVALID_ARGUMENT)
      try {
        return autostartJson(setAutostartEnabled(enabled))
      } catch (cause) {
        log.warn("Couldn't update the startup setting. %s", asError(cause))
        throw new Error("Couldn't update the startup setting.")
      }
    }
    default:
      throw new Error("Unknown native desktop operation.")
  }
}

function updateJson(state: DesktopUpdateState): NativeJson {
  return { ...state }
}

function autostartJson(state: DesktopAutostartState): NativeJson {
  return { ...state }
}

async function restartToInstall(host: Host, updates: Updates): Promise<void> {
  const runtime = host.requireRuntime()
  try {
    await updates.restartToInstall(
      () => runtime.shutdown(),
      (quitting) => {
        host.quitting = quitting
      },
    )
  } catch (cause) {
    if (!(cause instanceof RestartError) || !cause.afterShutdown) throw cause
    try {
      // The window stays open, so its server is selected again.
      await runtime.resumeAfterFailedUpdate(host.remote?.origin ?? null)
    } catch (resumeCause) {
      log.warn(
        `Could not resume Alloy after the failed update (${cause.message}): %s`,
        asError(resumeCause),
      )
      throw new Error("Could not resume Alloy after the failed update.")
    }
    throw new Error(cause.message)
  }
}

/**
 * `recording.*` operations. The native runtime runs most of them; the ones
 * that need a native dialog, the window's cookies, or the file manager run
 * here first, and the sender is checked again after each dialog.
 */
async function runRecordingOperation(
  host: Host,
  event: IpcMainInvokeEvent,
  remote: RemoteSession,
  operation: string,
  args: NativeJson[],
): Promise<NativeJson | undefined> {
  const runtime = host.requireRuntime()
  const parent = BrowserWindow.fromWebContents(event.sender)
  switch (operation) {
    case "recording.revealLibraryCapture": {
      const path = await runtime.revealPath(stringArgument(args, 0))
      shell.showItemInFolder(path)
      return null
    }
    case "recording.importLibraryFile": {
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [
          { name: t("Videos and images"), extensions: IMPORT_EXTENSIONS },
        ],
      }
      const picked = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))
      requireRemoteSender(host, event)
      const [path] = picked.filePaths
      if (picked.canceled || !path) return null
      return runtime.stageImport(path)
    }
    case "recording.selectOutputFolder": {
      const options: OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
      }
      const picked = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))
      requireRemoteSender(host, event)
      const [folder] = picked.filePaths
      if (picked.canceled || !folder) return null
      // Picking the folder applies it.
      return runtime.setOutputFolder(folder)
    }
    case "recording.downloadClip": {
      // The download goes to the selected server, never to an origin the
      // renderer names; the request carries only the clip to fetch.
      const cookie = await sessionCookieHeader(
        remote.window.webContents.session,
        remote.origin,
      )
      requireRemoteSender(host, event)
      return runtime.downloadClip(
        remote.origin,
        cookie,
        JSON.stringify(args[0] ?? null),
      )
    }
    case "recording.openNotificationSoundsFolder": {
      const folder = runtime.notificationSoundsFolder()
      const error = await shell.openPath(folder)
      if (error) throw new Error(error)
      return null
    }
    default:
      return runtime.invoke(operation, JSON.stringify(args))
  }
}
