import type { DesktopUpdateState } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

import type { StartupUpdateState } from "@/shared/ipc"

import {
  configureRecordingBackend,
  stopRecordingBackendForInstall,
} from "./recording"
import {
  configureRecordingHotkeys,
  unregisterRecordingHotkeys,
} from "./recording-hotkeys"
import {
  runInteractiveStartupUpdate,
  StartupDeadlineError,
  type StartupUpdateCheck,
  type StartupUpdateChoice,
  type StartupUpdateResult,
  withStartupDeadline,
} from "./startup-update"

// electron-updater is CommonJS with a lazy `autoUpdater` getter. Reading the
// default import keeps Rollup from capturing an undefined named binding.
const autoUpdater = electronUpdater.autoUpdater

const logger = createLogger("updater")

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const STARTUP_UPDATE_CHECK_TIMEOUT_MS = 2_500
const STARTUP_UPDATE_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000
const UPDATE_INSTALL_START_TIMEOUT_MS = 10_000
let state: DesktopUpdateState = idleUpdateState()
let startupState: StartupUpdateState = { phase: "inactive" }
let initialized = false
let startupFlowActive = false
let checkInterval: ReturnType<typeof setInterval> | null = null
let checkInFlight: Promise<DesktopUpdateState> | null = null
let downloadInFlight: Promise<DesktopUpdateState> | null = null
let installInFlight = false
let installAttempt:
  | { reject: (cause: Error) => void; finish: () => void }
  | undefined
let startupChoice:
  | {
      resolve: (choice: StartupUpdateChoice) => void
      timer: ReturnType<typeof setTimeout> | null
    }
  | undefined
const stateListeners = new Set<(state: DesktopUpdateState) => void>()
const startupStateListeners = new Set<(state: StartupUpdateState) => void>()

export function getUpdateState(): DesktopUpdateState {
  return state
}

export function getStartupUpdateState(): StartupUpdateState {
  return startupState
}

export async function checkForUpdatesNow(): Promise<DesktopUpdateState> {
  if (!app.isPackaged) {
    logger.info("update check skipped in development")
    return state
  }

  initAutoUpdater()
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

export function onStartupUpdateStateChange(
  listener: (state: StartupUpdateState) => void,
): () => void {
  startupStateListeners.add(listener)
  return () => startupStateListeners.delete(listener)
}

/**
 * Runs before the recorder and hotkeys start. Visible launches install a found
 * update. Login-item launches only stage it, so they never open an unexpected
 * installer while Windows is starting.
 */
export async function runStartupUpdateBeforeServices(
  interactive: boolean,
): Promise<StartupUpdateResult> {
  initAutoUpdater()
  if (!app.isPackaged) return "continue"

  startupFlowActive = true
  try {
    const result = interactive
      ? await runInteractiveStartupUpdate({
          currentVersion: app.getVersion(),
          check: checkForStartupUpdate,
          download: downloadStartupUpdate,
          install: restartToInstallUpdate,
          publish: setStartupState,
          choose: waitForStartupChoice,
        })
      : await stageLoginItemStartupUpdate()
    if (result === "continue") setStartupState({ phase: "inactive" })
    return result
  } finally {
    startupFlowActive = false
    startBackgroundUpdateChecks()
  }
}

export function retryStartupUpdate(): void {
  settleStartupChoice("retry")
}

export function continueStartup(): void {
  settleStartupChoice("continue")
}

/**
 * Stops capture services before NSIS starts. A downloaded update never forces
 * a restart during normal use; this runs at startup or after an explicit click.
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

/** Starts periodic checks after the bounded startup check. */
export function startBackgroundUpdateChecks(): void {
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
  // A background download must not install when the user quits while capture
  // is active. The next visible launch installs it at a safe boundary.
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

async function stageLoginItemStartupUpdate(): Promise<StartupUpdateResult> {
  const check = await checkForStartupUpdate()
  if (check.kind !== "available") return "continue"
  void downloadUpdateNow().catch((cause: unknown) => {
    logger.warn("login-item update download failed:", cause)
  })
  return "continue"
}

async function downloadStartupUpdate(): Promise<void> {
  try {
    await withStartupDeadline(
      downloadUpdateNow(),
      STARTUP_UPDATE_DOWNLOAD_TIMEOUT_MS,
      t(
        "The update download took too long. It will continue in the background.",
      ),
    )
  } catch (cause) {
    if (cause instanceof StartupDeadlineError) throw cause
    throw new Error(t("Alloy could not download the update."))
  }
}

async function checkForStartupUpdate(): Promise<StartupUpdateCheck> {
  const result = await withTimeout(
    runUpdateCheck(),
    STARTUP_UPDATE_CHECK_TIMEOUT_MS,
  )
  if (result.kind === "timeout") {
    return {
      kind: "unavailable",
      message: t("The update check took too long. Alloy will start normally."),
    }
  }
  if (result.kind === "error") {
    return {
      kind: "unavailable",
      message: t("Alloy could not check for updates. It will start normally."),
    }
  }
  if (result.state.status === "available" && result.state.version) {
    return { kind: "available", version: result.state.version }
  }
  if (result.state.status === "downloaded" && result.state.version) {
    return { kind: "available", version: result.state.version }
  }
  return { kind: "current" }
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
      if (!startupFlowActive && state.status === "available") {
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

function setStartupState(next: StartupUpdateState): void {
  startupState = next
  for (const listener of startupStateListeners) {
    try {
      listener(startupState)
    } catch (cause) {
      logger.warn("startup update listener threw:", cause)
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
  logger.warn("update install did not start; restarting recording backend")
  void configureRecordingBackend().catch(() => {
    logger.warn("failed to restart recording backend")
  })
  configureRecordingHotkeys()
  setState(idleUpdateState())
  startBackgroundUpdateChecks()
  attempt.reject(new Error(t("Alloy could not start the update installer.")))
}

function waitForStartupChoice(
  autoContinueMs: number | null,
): Promise<StartupUpdateChoice> {
  if (startupChoice) settleStartupChoice("continue")
  if (startupState.phase === "error" && autoContinueMs !== null) {
    setStartupState({
      ...startupState,
      autoContinueAt: new Date(Date.now() + autoContinueMs).toISOString(),
    })
  }
  return new Promise((resolve) => {
    startupChoice = {
      resolve,
      timer:
        autoContinueMs === null
          ? null
          : setTimeout(() => settleStartupChoice("continue"), autoContinueMs),
    }
  })
}

function settleStartupChoice(choice: StartupUpdateChoice): void {
  const pending = startupChoice
  if (!pending) return
  startupChoice = undefined
  if (pending.timer) clearTimeout(pending.timer)
  pending.resolve(choice)
}

function stopBackgroundUpdateChecks(): void {
  if (!checkInterval) return
  clearInterval(checkInterval)
  checkInterval = null
}

function withTimeout(
  promise: Promise<DesktopUpdateState>,
  timeoutMs: number,
): Promise<
  | { kind: "done"; state: DesktopUpdateState }
  | { kind: "error" }
  | { kind: "timeout" }
> {
  const result = promise.then(
    (next) => ({ kind: "done" as const, state: next }),
    () => ({ kind: "error" as const }),
  )
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  return Promise.race([result, timeout])
}
