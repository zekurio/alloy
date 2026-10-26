import { detectLocale, setClientLocale } from "@alloy/i18n"
import { app, dialog, Menu } from "electron"
import { z } from "zod"

import { RECORDING_EVENT_CHANNEL, UPDATES_EVENT_CHANNEL } from "../shared/ipc"
import { launchedAtLogin } from "./autostart"
import { restoreSavedServer } from "./connection"
import { Host } from "./host"
import { registerIpc } from "./ipc"
import { asError, attachLogSink, log } from "./log"
import { loadNativeAddon, type CaptureAction } from "./native"
import {
  APP_IDENTIFIER,
  nativeAddonPath,
  resolveFolders,
  type AppFolders,
} from "./paths"
import { createTray } from "./tray"
import { Updates } from "./updater"
import { flushWindowState } from "./window-state"
import { showActive, showConnect } from "./windows"

/** What a second launch hands to the running app. */
const LaunchRequestSchema = z.object({
  action: z.enum(["clip", "screenshot"]).nullable(),
})

/**
 * `--action clip` or `--action screenshot` (or `--action=clip`), which a
 * desktop shortcut or a script sends to the running app to save a capture
 * without a window.
 */
function requestedAction(argv: readonly string[]): CaptureAction | null {
  for (const [index, argument] of argv.entries()) {
    if (index === 0) continue
    const value =
      argument === "--action"
        ? argv[index + 1]
        : argument.startsWith("--action=")
          ? argument.slice("--action=".length)
          : undefined
    if (value === undefined) continue
    return value === "clip" || value === "screenshot" ? value : null
  }
  return null
}

/** Release builds have no console, so a startup failure gets a dialog. */
function failStartup(message: string): void {
  process.stderr.write(`Could not start Alloy: ${message}\n`)
  dialog.showErrorBox("Alloy could not start", message)
  app.exit(1)
}

/** Stops the recorder and media work, then quits. */
function requestQuit(host: Host): void {
  if (host.quitting) return
  host.quitting = true
  host.sendCancel()
  const stopped = host.runtime ? host.runtime.shutdown() : Promise.resolve()
  void stopped
    .catch((cause: Error) => {
      log.warn("Could not stop Alloy before exit: %s", cause)
    })
    .then(() => {
      // The last resize may still be waiting on its delay.
      flushWindowState(
        [host.connectWindow, host.remote?.window],
        host.preferences,
      )
      host.native.flushLog()
      app.quit()
    })
}

async function start(
  folders: AppFolders,
  action: CaptureAction | null,
  startsInTray: boolean,
  ready: (host: Host) => void,
): Promise<void> {
  Menu.setApplicationMenu(null)
  setClientLocale(
    detectLocale([...app.getPreferredSystemLanguages(), app.getLocale()]),
  )
  const native = loadNativeAddon(nativeAddonPath(folders))
  try {
    native.initLogging(folders.logs)
    attachLogSink(native)
  } catch (cause) {
    log.warn("Could not open the Alloy log file: %s", asError(cause))
  }
  log.info(`Alloy desktop ${app.getVersion()} started`)
  if (action) {
    log.warn(
      `\`--action ${action}\` found Alloy closed, so nothing was saved: there is no replay buffer yet. Alloy now runs in the tray for the next shortcut.`,
    )
  }

  const host = new Host(native, new native.Preferences(folders.data), folders)
  ready(host)
  const updates = new Updates(native, (state) =>
    host.sendToRemote(UPDATES_EVENT_CHANNEL, { ...state }),
  )
  registerIpc(host, updates)
  host.runtime = await native.createRuntime(
    {
      dataDir: folders.data,
      cacheDir: folders.cache,
      replayScratchDir: folders.replayScratch,
      defaultOutputDir: folders.defaultOutput,
      nativeRoot: folders.nativeRoot,
    },
    (event) => host.sendToRemote(RECORDING_EVENT_CHANNEL, event),
  )
  host.runtime.start()

  app.on("before-quit", (event) => {
    if (host.quitting) return
    // Quitting from anywhere but the tray (the OS, an installer) still stops
    // the recorder first.
    event.preventDefault()
    requestQuit(host)
  })

  // With a saved server the app restores its window directly and only opens
  // the connect screen if that fails. A tray start opens no window at all.
  if (!host.preferences.currentServer() && !startsInTray) showConnect(host)
  createTray(host, () => requestQuit(host))
  updates.startBackgroundChecks()
  void restoreSavedServer(host, !startsInTray)
}

function main(): void {
  const folders = resolveFolders()
  app.setName("Alloy")
  // Chromium's profile, and with it the single-instance lock, lives here.
  app.setPath("userData", folders.shell)
  if (process.platform === "win32") app.setAppUserModelId(APP_IDENTIFIER)
  // Overlay scrollbars keep the layout stable when content starts to scroll.
  app.commandLine.appendSwitch("enable-features", "OverlayScrollbar")

  const action = requestedAction(process.argv)
  // A login item and a shortcut that found the app closed both leave it in
  // the tray, where the user opens it from.
  const startsInTray = launchedAtLogin(process.argv) || action !== null
  if (!app.requestSingleInstanceLock({ action })) {
    app.quit()
    return
  }

  let host: Host | null = null
  app.on("second-instance", (_event, _argv, _directory, request) => {
    if (!host) return
    // The action travels as lock data: Chromium may reorder the argv it
    // forwards here.
    const parsed = LaunchRequestSchema.safeParse(request)
    const requested = parsed.success ? parsed.data.action : null
    if (requested) host.runtime?.trigger(requested)
    else showActive(host)
  })
  // Closing the last window keeps capture and media work alive in the tray.
  app.on("window-all-closed", () => undefined)
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault())
  })
  process.on("unhandledRejection", (cause) => {
    log.warn("Unhandled rejection in the main process: %s", asError(cause))
  })

  app
    .whenReady()
    .then(() =>
      start(folders, action, startsInTray, (started) => {
        host = started
      }),
    )
    .catch((cause) => failStartup(asError(cause).message))
}

main()
