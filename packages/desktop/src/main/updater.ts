import type { DesktopUpdateState } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"
import electronUpdater from "electron-updater"

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
 * `latest.yml` plus the installer. Downloads happen in the background and
 * install on quit; `checkForUpdatesAndNotify` shows a native toast once a
 * download is ready, and the web app surfaces a "restart to update" entry in
 * its notification center via the bridge state above. Users on an `-rc.N`
 * build keep receiving prereleases, stable builds only see full releases.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info("skipping update checks in development")
    return
  }

  autoUpdater.logger = logger
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
    logger.info(`update available: ${info.version}`)
    // autoDownload is on, so "available" means the download is starting.
    setState({ status: "downloading", version: info.version })
  })
  autoUpdater.on("update-downloaded", (info) => {
    logger.info(`update ${info.version} downloaded; it installs on quit`)
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
    void autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Failures already surface through the "error" event.
    })
  }
  check()
  timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
}
