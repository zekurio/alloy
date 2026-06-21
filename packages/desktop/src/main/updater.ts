import {
  normalizeDesktopUpdateChannel,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

import { getSavedUpdateChannel, saveUpdateChannel } from "./server-store"
import {
  isDesktopUpdateForChannel,
  resolveDesktopUpdateChannel,
} from "./update-channel"

// electron-updater is CommonJS with a lazy `autoUpdater` getter; read from the
// default import so Rollup does not capture an undefined named binding.
const autoUpdater = electronUpdater.autoUpdater

const logger = createLogger("updater")

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const INITIAL_UPDATE_CHECK_DELAY_MS = 30 * 1000
const CHANNEL_SWITCH_CHECK_DELAY_MS = 2 * 1000
const UPDATE_DOWNLOAD_DELAY_MS = 10 * 1000

let state: DesktopUpdateState = { status: "idle", version: null }
let updateChannel: DesktopUpdateChannel = "latest"
let initialized = false
let checkInterval: ReturnType<typeof setInterval> | null = null
let pendingCheckTimer: ReturnType<typeof setTimeout> | null = null
let pendingDownloadTimer: ReturnType<typeof setTimeout> | null = null
let checkInFlight = false
let downloadInFlight = false
const stateListeners = new Set<(state: DesktopUpdateState) => void>()

/** Current auto-update state, served to the web app over the desktop bridge. */
export function getUpdateState(): DesktopUpdateState {
  return state
}

export function getUpdateChannel(): DesktopUpdateChannel {
  return updateChannel
}

export function setUpdateChannel(value: unknown): DesktopUpdateChannel {
  const nextChannel = normalizeDesktopUpdateChannel(value)
  if (!nextChannel) throw new Error("Invalid update channel.")

  const previousChannel = updateChannel
  saveUpdateChannel(nextChannel)
  updateChannel = nextChannel

  if (previousChannel === nextChannel) return nextChannel

  clearPendingDownload()
  setState({ status: "idle", version: null })

  if (app.isPackaged && initialized) {
    configureAutoUpdater(nextChannel)
    ensureBackgroundChecks()
    scheduleUpdateCheck(CHANNEL_SWITCH_CHECK_DELAY_MS)
  }

  return nextChannel
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

function defaultUpdateChannel(): DesktopUpdateChannel {
  return resolveDesktopUpdateChannel(app.getVersion())
}

function selectedUpdateChannel(): DesktopUpdateChannel {
  return getSavedUpdateChannel() ?? defaultUpdateChannel()
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
 * `latest.yml` or `unstable.yml` plus the installer. The app starts on the
 * channel implied by its packaged version unless the user selected another
 * channel, accepts only matching update versions, downloads in the background,
 * and surfaces a "restart to update" entry in the web app sidebar via the
 * bridge state above.
 */
export function initAutoUpdater(): void {
  updateChannel = selectedUpdateChannel()

  if (!app.isPackaged) {
    logger.info("skipping update checks in development")
    return
  }

  autoUpdater.logger = logger
  configureAutoUpdater(updateChannel)

  autoUpdater.on("checking-for-update", () => {
    if (state.status === "idle") {
      setState({ status: "checking", version: null })
    }
  })
  autoUpdater.on("update-not-available", () => {
    if (state.status === "downloaded") return
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
    scheduleUpdateDownload(info.version, updateChannel)
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
    stopBackgroundChecks()
  })
  // An emitted "error" without a listener would crash the process. Offline
  // checks are routine for a desktop app, so log at warn rather than error.
  autoUpdater.on("error", (cause) => {
    logger.warn("update check failed:", cause)
    if (state.status !== "downloaded") {
      setState({ status: "idle", version: null })
    }
  })

  initialized = true
  ensureBackgroundChecks()
  scheduleUpdateCheck(INITIAL_UPDATE_CHECK_DELAY_MS)
}

function configureAutoUpdater(channel: DesktopUpdateChannel): void {
  const installedChannel = defaultUpdateChannel()
  const allowsPrerelease = channel === "unstable"
  const allowsDowngrade = allowsPrerelease || channel !== installedChannel
  autoUpdater.channel = channel
  autoUpdater.allowPrerelease = allowsPrerelease
  autoUpdater.allowDowngrade = allowsDowngrade
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.info(
    `using ${channel} update channel (allowPrerelease=${allowsPrerelease}, allowDowngrade=${allowsDowngrade})`,
  )
}

function ensureBackgroundChecks(): void {
  if (checkInterval) return
  checkInterval = setInterval(
    () => scheduleUpdateCheck(0),
    UPDATE_CHECK_INTERVAL_MS,
  )
}

function stopBackgroundChecks(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  clearPendingCheck()
}

function scheduleUpdateCheck(delayMs: number): void {
  if (!app.isPackaged || state.status !== "idle") return
  clearPendingCheck()
  pendingCheckTimer = setTimeout(() => {
    pendingCheckTimer = null
    runUpdateCheck()
  }, delayMs)
}

function runUpdateCheck(): void {
  if (checkInFlight || state.status !== "idle") return

  checkInFlight = true
  void autoUpdater
    .checkForUpdates()
    .catch(() => {
      // Failures already surface through the "error" event.
    })
    .finally(() => {
      checkInFlight = false
    })
}

function scheduleUpdateDownload(
  version: string,
  channel: DesktopUpdateChannel,
): void {
  clearPendingDownload()
  pendingDownloadTimer = setTimeout(() => {
    pendingDownloadTimer = null
    if (
      downloadInFlight ||
      state.status !== "downloading" ||
      state.version !== version ||
      updateChannel !== channel
    ) {
      return
    }

    downloadInFlight = true
    void autoUpdater
      .downloadUpdate()
      .catch((cause) => {
        logger.warn("update download failed:", cause)
        if (state.status !== "downloaded") {
          setState({ status: "idle", version: null })
        }
      })
      .finally(() => {
        downloadInFlight = false
      })
  }, UPDATE_DOWNLOAD_DELAY_MS)
}

function clearPendingCheck(): void {
  if (!pendingCheckTimer) return
  clearTimeout(pendingCheckTimer)
  pendingCheckTimer = null
}

function clearPendingDownload(): void {
  if (!pendingDownloadTimer) return
  clearTimeout(pendingDownloadTimer)
  pendingDownloadTimer = null
}
