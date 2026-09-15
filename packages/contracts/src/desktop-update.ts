/**
 * Auto-update state exposed to the desktop web app through its native API. This
 * never goes through the server because an update belongs to this machine.
 */
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
export interface DesktopUpdateState {
  /** False when this build has no native updater configuration. */
  supported: boolean
  status: DesktopUpdateStatus
  /** Version currently running on this machine, e.g. "0.1.0". */
  currentVersion: string | null
  /** Version of the pending update once one is known, e.g. "0.2.0". */
  version: string | null
  /**
   * RFC 3339 time of the last completed check, whether the shell's periodic
   * background check or a manual one. Null until the first check finishes.
   */
  lastCheckedAt: string | null
}

/** Desktop auto-update state and controls exposed through the native bridge. */
export interface AlloyDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  /**
   * Runs an immediate update check instead of waiting for the shell's
   * periodic background check. Allowed while idle or while an update is
   * available; a newer release replaces the pending one.
   */
  checkForUpdates(): Promise<DesktopUpdateState>
  /** Downloads the available update after the user confirms the action. */
  downloadUpdate(): Promise<DesktopUpdateState>
  /** Quits and installs the downloaded update; no-op when none is ready. */
  restartToInstall(): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}
