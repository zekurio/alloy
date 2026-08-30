import type { DesktopUpdateState } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

import {
  configureRecordingBackend,
  stopRecordingBackendForInstall,
} from "./recording"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"

// electron-updater is CommonJS with a lazy `autoUpdater` getter. Reading the
// default import keeps Rollup from capturing an undefined named binding.
const autoUpdater = electronUpdater.autoUpdater

const logger = createLogger("updater")

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const UPDATE_INSTALL_START_TIMEOUT_MS = 10_000
let state: DesktopUpdateState = idleUpdateState()
let initialized = false
let checkInterval: ReturnType<typeof setInterval> | null = null
let checkInFlight: Promise<DesktopUpdateState> | null = null
let downloadInFlight: Promise<DesktopUpdateState> | null = null
let installInFlight = false
let installAttempt:
  | { reject: (cause: Error) => void; finish: () => void }
  | undefined
const stateListeners = new Set<(state: DesktopUpdateState) => void>()

export function getUpdateState(): DesktopUpdateState {
  return state
}

export async function checkForUpdatesNow(): Promise<DesktopUpdateState> {
  if (!app.isPackaged) {
    logger.info("update check skipped in development")
    return state
  }

  startBackgroundUpdateChecks()
  return runUpdateCheck()
}

/** Downloads one discovered update. Concurrent callers share the same work. */
export function downloadUpdateNow(): Promise<DesktopUpdateState> {
  if (!app.isPackaged) {
    logger.info("update download skipped in development")
    return Promise.resolve(state)
  }

  initAutoUpdater()
  if (downloadInFlight) return downloadInFlight
  if (state.status === "downloaded") return Promise.resolve(state)
  if (state.status !== "available" || !state.version) {
    logger.warn("download requested but no update is available; ignoring")
    return Promise.resolve(state)
  }

  const version = state.version
  setState({ ...idleUpdateState(), status: "downloading", version })
  downloadInFlight = autoUpdater
    .downloadUpdate()
    .then(() => state)
    .catch((cause: unknown) => {
      logger.warn("update download failed:", cause)
      if (state.status !== "downloaded") {
        setState({ ...idleUpdateState(), status: "available", version })
      }
      throw cause
    })
    .finally(() => {
      downloadInFlight = null
    })
  return downloadInFlight
}

export function onUpdateStateChange(
  listener: (state: DesktopUpdateState) => void,
): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/**
 * Stops capture services before NSIS starts. A downloaded update never forces
 * a restart during normal use; this runs only after an explicit click.
 */
export async function restartToInstallUpdate(): Promise<void> {
  if (installInFlight) return
  if (state.status !== "downloaded") {
    logger.warn("restart requested but no update is downloaded; ignoring")
    return
  }

  installInFlight = true
  logger.info("stopping recording backend before update install")
  unregisterRecordingHotkeys()
  const recorderStopped = await stopRecordingBackendForInstall().catch(
    (cause: unknown) => {
      logger.warn("recorder shutdown failed before update install:", cause)
      return false
    },
  )
  if (!installInFlight) return
  if (!recorderStopped) {
    installInFlight = false
    configureRecordingHotkeys()
    throw new Error(t("The recorder did not stop. Try restarting again."))
  }

  logger.info(`restarting to install ${state.version ?? "update"}`)
  // quitAndInstall closes windows before Electron emits before-quit. The
  // recorder must be stopped before this call because NSIS replaces its files.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      failInstallAttempt()
    }, UPDATE_INSTALL_START_TIMEOUT_MS)
    const handleBeforeQuit = () => {
      clearTimeout(timer)
      installAttempt = undefined
      resolve()
    }
    app.once("before-quit", handleBeforeQuit)
    installAttempt = {
      reject,
      finish: () => {
        clearTimeout(timer)
        app.off("before-quit", handleBeforeQuit)
      },
    }
    autoUpdater.quitAndInstall(true, true)
  })
}

/** Schedules periodic checks without making a network request during launch. */
export function startBackgroundUpdateChecks(): void {
  initAutoUpdater()
  if (!app.isPackaged || state.status === "downloaded") return
  if (state.status === "available") {
    void downloadUpdateNow().catch(() => {
      // The updater error event and logs already report this failure.
    })
  }
  if (checkInterval) return
  checkInterval = setInterval(() => {
    if (state.status === "available") {
      void downloadUpdateNow().catch(() => {
        // The updater error event and logs already report this failure.
      })
      return
    }
    void runUpdateCheck().catch(() => {
      // The updater error event and logs already report this failure.
    })
  }, UPDATE_CHECK_INTERVAL_MS)
  checkInterval.unref?.()
}

function initAutoUpdater(): void {
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
  // A background download must not install when the user quits while capture
  // is active. The update UI lets the user install it at a safe boundary.
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
      status: "available",
      version: info.version,
    })
  })
  autoUpdater.on("update-downloaded", (info) => {
    logger.info(`update ${info.version} downloaded; waiting for safe restart`)
    setState({
      ...idleUpdateState(),
      status: "downloaded",
      version: info.version,
    })
    stopBackgroundUpdateChecks()
  })
  autoUpdater.on("error", (cause) => {
    logger.warn("update operation failed:", cause)
    if (installAttempt) {
      failInstallAttempt()
      return
    }
    if (state.status === "checking") setState(idleUpdateState())
  })
}

function runUpdateCheck(): Promise<DesktopUpdateState> {
  if (checkInFlight) return checkInFlight
  if (
    state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded"
  ) {
    return Promise.resolve(state)
  }

  setState({ ...idleUpdateState(), status: "checking" })
  checkInFlight = autoUpdater
    .checkForUpdates()
    .then(() => state)
    .finally(() => {
      checkInFlight = null
      if (state.status === "available") {
        void downloadUpdateNow().catch(() => {
          // The updater error event and logs already report this failure.
        })
      }
    })
  return checkInFlight
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

function failInstallAttempt(): void {
  const attempt = installAttempt
  if (!attempt) return
  installAttempt = undefined
  attempt.finish()
  installInFlight = false
  restoreCaptureServicesAfterInstallFailure()
  setState(idleUpdateState())
  startBackgroundUpdateChecks()
  attempt.reject(new Error(t("Alloy could not start the update installer.")))
}

function restoreCaptureServicesAfterInstallFailure(): void {
  logger.warn("update install did not start; restarting recording backend")
  void configureRecordingBackend().catch(() => {
    logger.warn("failed to restart recording backend")
  })
  configureRecordingHotkeys()
}

function stopBackgroundUpdateChecks(): void {
  if (!checkInterval) return
  clearInterval(checkInterval)
  checkInterval = null
}
