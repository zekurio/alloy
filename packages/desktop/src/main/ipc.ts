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
import { z } from "zod"

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
import {
  destroyConnect,
  openSettings,
  showConnect,
  showPendingConnect,
} from "./windows"

const INVALID_ARGUMENT = "Invalid native argument."

const ArgsSchema = z.array(z.json())
const UrlArgumentSchema = z.string()
const ConnectCommandSchema = z.enum(CONNECT_COMMANDS)
const ShellOperationSchema = z.enum(SHELL_OPERATIONS)

/** Files the import picker offers, as the Tauri host did. */
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
  const parsed = z.string().safeParse(args[index])
  if (!parsed.success) throw new Error(INVALID_ARGUMENT)
  return parsed.data
}

/**
 * Registers a handler whose failures reach the renderer as their message,
 * which the renderer translates. Electron would otherwise prefix it.
 * Arguments pass through JSON first, as the Tauri host's did, so fields set
 * to `undefined` are dropped rather than rejected.
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
      const parsed = ArgsSchema.safeParse(JSON.parse(JSON.stringify(args)))
      if (!parsed.success) throw new Error(INVALID_ARGUMENT)
      return { ok: true, value: await run(event, ...parsed.data) }
    } catch (cause) {
      return { ok: false, error: asError(cause).message }
    }
  })
}

export function registerIpc(host: Host, updates: Updates): void {
  handle(CONNECT_CHANNEL, async (event, name, url) => {
    requireConnectSender(host, event)
    const command = ConnectCommandSchema.safeParse(name)
    if (!command.success) throw new Error("Unknown native desktop operation.")
    switch (command.data) {
      case "connectServer": {
        const result = await connectToServer(host, parseUrl(url))
        // The connect screen is destroyed rather than hidden: it is cheap to
        // recreate, and it would otherwise keep a renderer process alive.
        destroyConnect(host)
        return result
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
        )
    }
  })

  handle(SHELL_CHANNEL, async (event, name) => {
    const remote = requireRemoteSender(host, event)
    const operation = ShellOperationSchema.safeParse(name)
    if (!operation.success) throw new Error("Unknown native desktop operation.")
    await runShellOperation(host, remote, operation.data)
    return undefined
  })

  handle(API_CHANNEL, async (event, name, rawArgs) => {
    const remote = requireRemoteSender(host, event)
    const operation = z.string().safeParse(name)
    const args = ArgsSchema.safeParse(rawArgs ?? [])
    if (!operation.success || !args.success) throw new Error(INVALID_ARGUMENT)
    if (operation.data === "servers.switchTo") {
      // A successful switch replaces the calling window, so return without
      // checking it again.
      return connectToServer(host, stringArgument(args.data, 0))
    }
    const result = await runApiOperation(
      host,
      updates,
      event,
      remote,
      operation.data,
      args.data,
    )
    // The answer only goes to a window that still shows the selected server.
    requireRemoteSender(host, event)
    return result
  })
}

function parseUrl(url: NativeJson | undefined): string {
  const parsed = UrlArgumentSchema.safeParse(url)
  if (!parsed.success) throw new Error(INVALID_ARGUMENT)
  return parsed.data
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
    case "openSettings":
      await openSettings(window)
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
    case "reloadApp":
      window.webContents.reload()
      return
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
    case "servers.current":
      return remote.origin
    case "servers.forget": {
      const origin = host.native.normalizeServerOrigin(stringArgument(args, 0))
      if (origin === remote.origin) {
        throw new Error("Switch to another server before forgetting this one.")
      }
      return forgetSavedServer(host, origin)
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
      const enabled = z.boolean().safeParse(args[0])
      if (!enabled.success) throw new Error(INVALID_ARGUMENT)
      try {
        return autostartJson(setAutostartEnabled(enabled.data))
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
      await runtime.resumeAfterFailedUpdate()
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
    case "recording.importLibraryFiles": {
      // The web app imports one file per pick; the result keeps its list
      // shape for older web builds.
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
      if (picked.canceled || !path) {
        return { staged: [], failed: [], canceled: true }
      }
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
      const folder = runtime.notificationSoundsFolder(stringArgument(args, 0))
      const error = await shell.openPath(folder)
      if (error) throw new Error(error)
      return null
    }
    default:
      return runtime.invoke(operation, JSON.stringify(args))
  }
}
