import type { DesktopUpdateState } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

// electron-updater is CommonJS with a lazy `autoUpdater` getter; read from the
// default import so Rollup does not capture an undefined named binding.
const autoUpdater = electronUpdater.autoUpdater

const logger = createLogger("updater")

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const INITIAL_UPDATE_CHECK_DELAY_MS = 30 * 1000
const UPDATE_DOWNLOAD_DELAY_MS = 10 * 1000

let state: DesktopUpdateState = idleUpdateState()
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

/** Runs an immediate user-requested update check. */
export async function checkForUpdatesNow(): Promise<DesktopUpdateState> {
  if (!app.isPackaged) {
    logger.info("manual update check skipped in development")
    return state
  }

  if (!initialized) initAutoUpdater()

  ensureBackgroundChecks()
  clearPendingCheck()
  return runUpdateCheck({ force: true })
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
  if (
    next.status === state.status &&
    next.currentVersion === state.currentVersion &&
    next.version === state.version
  ) {
    return
  }
  state = next
  for (const listener of stateListeners) {
    try {
      listener(state)
    } catch (cause) {
      logger.warn("update state listener threw:", cause)
    }
  }
}

function idleUpdateState(): DesktopUpdateState {
  return { status: "idle", currentVersion: app.getVersion(), version: null }
}

/**
 * Background auto-update from the GitHub releases feed. electron-builder
 * embeds `app-update.yml` (from the `publish` config) into packaged builds,
 * which is where the updater finds the repo; published releases expose
 * `latest.yml` plus the installer. The updater downloads in the background
 * and surfaces a "restart to update" entry in the web app sidebar via the
 * bridge state above.
 */
export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) {
    logger.info("skipping update checks in development")
    return
  }

  autoUpdater.logger = logger
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on("checking-for-update", () => {
    if (state.status === "idle") {
      setState({ ...idleUpdateState(), status: "checking" })
    }
  })
  autoUpdater.on("update-not-available", () => {
    if (state.status === "downloaded") return
    setState(idleUpdateState())
  })
  autoUpdater.on("update-available", (info) => {
    logger.info(`update available: ${info.version}`)
    setState({
      ...idleUpdateState(),
      status: "downloading",
      version: info.version,
    })
    scheduleUpdateDownload(info.version)
  })
  autoUpdater.on("update-downloaded", (info) => {
    logger.info(`update ${info.version} downloaded; waiting for restart`)
    setState({
      ...idleUpdateState(),
      status: "downloaded",
      version: info.version,
    })
    // Nothing left to look for until the user restarts into the new version.
    stopBackgroundChecks()
  })
  // An emitted "error" without a listener would crash the process. Offline
  // checks are routine for a desktop app, so log at warn rather than error.
  autoUpdater.on("error", (cause) => {
    logger.warn("update check failed:", cause)
    if (state.status !== "downloaded") {
      setState(idleUpdateState())
    }
  })

  ensureBackgroundChecks()
  scheduleUpdateCheck(INITIAL_UPDATE_CHECK_DELAY_MS)
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
    void runUpdateCheck()
  }, delayMs)
}

async function runUpdateCheck(
  options: { force?: boolean } = {},
): Promise<DesktopUpdateState> {
  if (checkInFlight) return state
  if (state.status === "downloaded" || state.status === "downloading") {
    return state
  }
  if (!options.force && state.status !== "idle") return state

  checkInFlight = true
  if (state.status === "idle") {
    setState({ ...idleUpdateState(), status: "checking" })
  }
  await autoUpdater
    .checkForUpdates()
    .catch(() => {
      // Failures already surface through the "error" event.
    })
    .finally(() => {
      checkInFlight = false
    })
  return state
}

function scheduleUpdateDownload(version: string): void {
  clearPendingDownload()
  pendingDownloadTimer = setTimeout(() => {
    pendingDownloadTimer = null
    if (
      downloadInFlight ||
      state.status !== "downloading" ||
      state.version !== version
    ) {
      return
    }

    downloadInFlight = true
    void autoUpdater
      .downloadUpdate()
      .catch((cause) => {
        logger.warn("update download failed:", cause)
        if (state.status !== "downloaded") {
          setState(idleUpdateState())
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
