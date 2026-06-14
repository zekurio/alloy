import type { DesktopUpdateState } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

import {
  isDesktopUpdateForChannel,
  resolveDesktopUpdateChannel,
} from "./update-channel"

// electron-updater is CommonJS with a lazy `autoUpdater` getter; destructuring
// the default import keeps that laziness intact in the rollup bundle, where a
// named import could capture an undefined binding at build time.
const { autoUpdater } = electronUpdater

const logger = createLogger("updater")

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let state: DesktopUpdateState = { status: "idle", version: null }
const stateListeners = new Set<(state: DesktopUpdateState) => void>()

/** Current auto-update state, served to the web app over the desktop bridge. */
export function getUpdateState(): DesktopUpdateState {
  return state
}

/** Subscribe to update-state changes (used to push events to windows). */
export function onUpdateStateChange(
  listener: (state: DesktopUpdateState) => void,
): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/**
 * Quit and install the downloaded update, relaunching into the new version.
 * No-op unless a download has finished, so a stale renderer can't quit the
 * app for nothing.
 */
export function restartToInstallUpdate(): void {
  if (state.status !== "downloaded") {
    logger.warn("restart requested but no update is downloaded; ignoring")
    return
  }
  logger.info(`restarting to install ${state.version ?? "update"}`)
  // Silent install + relaunch. The before-quit sidecar shutdown still runs:
  // quitAndInstall goes through the normal quit flow, and the installer fires
  // on the final quit.
  autoUpdater.quitAndInstall(true, true)
}

function setState(next: DesktopUpdateState): void {
  if (next.status === state.status && next.version === state.version) return
  state = next
  for (const listener of stateListeners) {
    try {
      listener(state)
    } catch (cause) {
      logger.warn("update state listener threw:", cause)
    }
  }
}

/**
 * Background auto-update from the GitHub releases feed. electron-builder
 * embeds `app-update.yml` (from the `publish` config) into packaged builds,
 * which is where the updater finds the repo; published releases expose
 * `latest.yml` or `nightly.yml` plus the installer. The app derives the
 * selected channel from its packaged version, accepts only matching update
 * versions, downloads in the background, and surfaces a "restart to update"
 * entry in the web app notification center via the bridge state above.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info("skipping update checks in development")
    return
  }

  autoUpdater.logger = logger
  const updateChannel = resolveDesktopUpdateChannel(app.getVersion())
  const allowsPrerelease = updateChannel === "nightly"
  autoUpdater.channel = updateChannel
  autoUpdater.allowPrerelease = allowsPrerelease
  autoUpdater.allowDowngrade = allowsPrerelease
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.info(
    `using ${updateChannel} update channel (allowPrerelease=${allowsPrerelease}, allowDowngrade=${allowsPrerelease})`,
  )

  let timer: ReturnType<typeof setInterval> | null = null

  autoUpdater.on("checking-for-update", () => {
    if (state.status === "idle") {
      setState({ status: "checking", version: null })
    }
  })
  autoUpdater.on("update-not-available", () => {
    setState({ status: "idle", version: null })
  })
  autoUpdater.on("update-available", (info) => {
    if (!isDesktopUpdateForChannel(info.version, updateChannel)) {
      logger.warn(
        `ignoring ${info.version} update from non-${updateChannel} channel`,
      )
      setState({ status: "idle", version: null })
      return
    }

    logger.info(`update available: ${info.version}`)
    setState({ status: "downloading", version: info.version })
    void autoUpdater.downloadUpdate().catch((cause) => {
      logger.warn("update download failed:", cause)
      if (state.status !== "downloaded") {
        setState({ status: "idle", version: null })
      }
    })
  })
  autoUpdater.on("update-downloaded", (info) => {
    if (!isDesktopUpdateForChannel(info.version, updateChannel)) {
      logger.warn(
        `downloaded ${info.version} update from non-${updateChannel} channel; ignoring`,
      )
      setState({ status: "idle", version: null })
      return
    }

    logger.info(`update ${info.version} downloaded; waiting for restart`)
    setState({ status: "downloaded", version: info.version })
    // Nothing left to look for until the user restarts into the new version.
    if (timer) clearInterval(timer)
  })
  // An emitted "error" without a listener would crash the process. Offline
  // checks are routine for a desktop app, so log at warn rather than error.
  autoUpdater.on("error", (cause) => {
    logger.warn("update check failed:", cause)
    if (state.status !== "downloaded") {
      setState({ status: "idle", version: null })
    }
  })

  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => {
      // Failures already surface through the "error" event.
    })
  }
  check()
  timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
}
