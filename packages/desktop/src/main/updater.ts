import type {
  DesktopUpdateState,
  DesktopUpdateStatus,
} from "@alloy/contracts/desktop-update"
import { app } from "electron"
import electronUpdater, {
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from "electron-updater"

import { asError, log } from "./log"
import type { NativeAddon } from "./native"

// electron-updater is CommonJS with a lazy `autoUpdater` getter; reading it
// from the default import keeps the bundler from capturing it too early.
const { autoUpdater } = electronUpdater

const UPDATE_UNSUPPORTED_ERROR =
  "Automatic updates are unavailable in this build."
const CHECK_FAILED = "Couldn't check for updates."
const DOWNLOAD_FAILED = "Couldn't download the update."
const RESTART_FAILED = "Couldn't restart to update."
/**
 * How long after launch the first release check waits, so restoring the
 * saved server and starting the recorder are not competing with it.
 */
const UPDATE_CHECK_STARTUP_DELAY_MS = 5 * 60 * 1000
/**
 * Releases ship a few times a week at most, so an hourly poll keeps every
 * install quiet without a noticeable delay before an update is offered.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** How long the installer may take to start before the restart counts as failed. */
const INSTALL_START_TIMEOUT_MS = 10_000

/**
 * The release key's public half, base64 of the minisign public key file.
 * Release builds set it from `ALLOY_UPDATER_PUBLIC_KEY`; without it, as in
 * development, automatic updates are off.
 */
const UPDATE_PUBLIC_KEY = __ALLOY_UPDATER_PUBLIC_KEY__

/** The installer's minisign signature, which the release adds to `latest.yml`. */
function releaseSignature(info: UpdateInfo): string | null {
  // SAFETY: `latest.yml` is parsed as is, so fields the release adds stay on
  // the update info; a missing or non-string field fails the check below.
  const signature = (info as UpdateInfo & { alloySignature?: string })
    .alloySignature
  return signature?.trim() ? signature : null
}

/** What electron-updater reported downloading, once it has. */
interface DownloadedUpdate {
  event: UpdateDownloadedEvent | null
}

/** Why `restartToInstall` returned instead of restarting. */
export class RestartError extends Error {
  /** True when the shutdown step ran, so the recorder must be resumed. */
  readonly afterShutdown: boolean

  constructor(message: string, afterShutdown: boolean) {
    super(message)
    this.afterShutdown = afterShutdown
  }
}

/**
 * Release checks and installs through electron-updater, reading `latest.yml`
 * from the latest GitHub release. A downloaded installer must match the
 * minisign signature the release carries for it before it can be installed.
 */
export class Updates {
  private state: DesktopUpdateState
  private pending: UpdateInfo | null = null
  private downloaded = false
  private checkInFlight = false
  private downloadInFlight = false
  private installInFlight = false

  constructor(
    private readonly native: NativeAddon,
    private readonly publish: (state: DesktopUpdateState) => void,
  ) {
    this.state = {
      status: "idle",
      currentVersion: app.getVersion(),
      version: null,
      supported: Updates.supported(),
      lastCheckedAt: null,
      downloadProgress: null,
    }
    if (!this.state.supported) return
    autoUpdater.logger = {
      info: (message) => log.info(`[updater] ${String(message)}`),
      warn: (message) => log.warn(`[updater] ${String(message)}`),
      error: (message) => log.warn(`[updater] ${String(message)}`),
    }
    autoUpdater.autoDownload = false
    // An update never installs on quit: the user restarts into it from the
    // app, at a moment no capture is running.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.on("error", (cause) => {
      log.warn("Update operation failed. %s", cause)
    })
  }

  /** Packaged Windows builds with a release key; others never check. */
  static supported(): boolean {
    return (
      app.isPackaged &&
      process.platform === "win32" &&
      UPDATE_PUBLIC_KEY.trim() !== ""
    )
  }

  getState(): DesktopUpdateState {
    return { ...this.state }
  }

  /** Polls the release feed in the background while the app runs. */
  startBackgroundChecks(): void {
    if (!this.state.supported) return
    const check = () => {
      this.checkForUpdates().catch((cause: Error) => {
        log.warn("Background update check failed: %s", cause)
      })
    }
    setTimeout(() => {
      check()
      setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    }, UPDATE_CHECK_STARTUP_DELAY_MS)
  }

  /**
   * Checks the release feed. A check runs from `idle` or `available`, so a
   * later release replaces a pending update the user has not downloaded
   * yet. While `available`, the status stays put during the check so the
   * "update available" UI does not flicker on every background poll.
   */
  async checkForUpdates(): Promise<DesktopUpdateState> {
    this.requireUpdater()
    if (
      this.checkInFlight ||
      (this.state.status !== "idle" && this.state.status !== "available")
    ) {
      return this.getState()
    }
    this.checkInFlight = true
    if (this.state.status === "idle") this.setStatus("checking")
    let info: UpdateInfo | null
    try {
      const result = await autoUpdater.checkForUpdates()
      info = result?.isUpdateAvailable ? result.updateInfo : null
    } catch (cause) {
      this.checkInFlight = false
      // A failed check leaves things where it started.
      if (this.status() === "checking") this.setStatus("idle", null)
      log.warn(`${CHECK_FAILED} %s`, asError(cause))
      throw new Error(CHECK_FAILED)
    }
    this.checkInFlight = false
    const checkedAt = new Date().toISOString()
    // A download that started during the check owns the pending update.
    const status = this.status()
    if (
      this.downloadInFlight ||
      status === "downloading" ||
      status === "downloaded"
    ) {
      this.update({ lastCheckedAt: checkedAt })
      return this.getState()
    }
    if (info) {
      if (this.state.version !== info.version) {
        this.pending = info
        this.downloaded = false
      }
      this.update({
        status: "available",
        version: info.version,
        lastCheckedAt: checkedAt,
      })
    } else {
      this.pending = null
      this.downloaded = false
      this.update({ status: "idle", version: null, lastCheckedAt: checkedAt })
    }
    return this.getState()
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    this.requireUpdater()
    if (this.downloadInFlight || this.downloaded || !this.pending) {
      return this.getState()
    }
    this.downloadInFlight = true
    this.setStatus("downloading")
    // electron-updater downloads the release its latest check found, which a
    // background check may have replaced since; its event names the release
    // and the file, so the signature always belongs to what gets installed.
    const downloaded: DownloadedUpdate = { event: null }
    const onDownloaded = (event: UpdateDownloadedEvent) => {
      downloaded.event = event
    }
    autoUpdater.on("update-downloaded", onDownloaded)
    // Published in whole percent steps, so the bridge carries at most a
    // hundred progress updates per download.
    const onProgress = (progress: ProgressInfo) => {
      const fraction = Math.min(Math.max(progress.percent / 100, 0), 1)
      const previous = this.state.downloadProgress ?? 0
      if (Math.floor(fraction * 100) > Math.floor(previous * 100)) {
        this.update({ downloadProgress: fraction })
      }
    }
    autoUpdater.on("download-progress", onProgress)
    let version: string
    try {
      await autoUpdater.downloadUpdate()
      const update = downloaded.event
      if (!update) throw new Error("The download reported no installer.")
      const signature = releaseSignature(update)
      if (!signature) throw new Error("The release has no update signature.")
      await this.native.verifyUpdateSignature(
        UPDATE_PUBLIC_KEY,
        signature,
        update.downloadedFile,
      )
      version = update.version
    } catch (cause) {
      this.downloadInFlight = false
      this.setStatus("available")
      log.warn(`${DOWNLOAD_FAILED} %s`, asError(cause))
      throw new Error(DOWNLOAD_FAILED)
    } finally {
      autoUpdater.off("update-downloaded", onDownloaded)
      autoUpdater.off("download-progress", onProgress)
    }
    this.downloadInFlight = false
    this.downloaded = true
    this.setStatus("downloaded", version)
    return this.getState()
  }

  /**
   * Runs `stop`, then quits into the downloaded installer, which restarts
   * Alloy once it has finished. `beforeQuit` lets the app's own quit
   * handling stand aside. Any error once `stop` has started is a
   * `RestartError` with `afterShutdown` set.
   */
  async restartToInstall(
    stop: () => Promise<void>,
    beforeQuit: (quitting: boolean) => void,
  ): Promise<void> {
    try {
      this.requireUpdater()
    } catch (cause) {
      throw new RestartError(asError(cause).message, false)
    }
    if (this.installInFlight || !this.downloaded) return
    this.installInFlight = true
    try {
      await stop()
    } catch (cause) {
      this.installInFlight = false
      throw new RestartError(asError(cause).message, true)
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (failed: Error | null) => {
          clearTimeout(timer)
          app.off("before-quit", started)
          autoUpdater.off("error", onError)
          if (failed) reject(failed)
          else resolve()
        }
        const started = () => finish(null)
        const onError = (cause: Error) => finish(cause)
        const timer = setTimeout(
          () => finish(new Error("The installer did not start.")),
          INSTALL_START_TIMEOUT_MS,
        )
        app.once("before-quit", started)
        autoUpdater.once("error", onError)
        beforeQuit(true)
        autoUpdater.quitAndInstall(true, true)
      })
    } catch (cause) {
      beforeQuit(false)
      this.installInFlight = false
      this.setStatus("downloaded")
      log.warn(`${RESTART_FAILED} %s`, asError(cause))
      throw new RestartError(RESTART_FAILED, true)
    }
  }

  /** Read through a call: the status changes while a check is awaited. */
  private status(): DesktopUpdateStatus {
    return this.state.status
  }

  private requireUpdater(): void {
    if (!this.state.supported) throw new Error(UPDATE_UNSUPPORTED_ERROR)
  }

  /** Progress starts at zero with a download and is null otherwise. */
  private setStatus(
    status: DesktopUpdateStatus,
    version?: string | null,
  ): void {
    const downloadProgress = status === "downloading" ? 0 : null
    this.update(
      version === undefined
        ? { status, downloadProgress }
        : { status, version, downloadProgress },
    )
  }

  private update(changes: Partial<DesktopUpdateState>): void {
    this.state = { ...this.state, ...changes }
    this.publish(this.getState())
  }
}
