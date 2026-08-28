/**
 * Auto-update state exposed to the bundled app through its native API. This
 * never goes through the server because an update belongs to this machine.
 */
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  /** Version currently running on this machine, e.g. "0.1.0". */
  currentVersion: string | null
  /** Version of the pending update once one is known, e.g. "0.2.0". */
  version: string | null
}

/** Desktop auto-update state and controls exposed to the bundled app. */
export interface AlloyDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  /** Runs an immediate update check instead of waiting for the background interval. */
  checkForUpdates(): Promise<DesktopUpdateState>
  /** Downloads the available update after the user confirms the action. */
  downloadUpdate(): Promise<DesktopUpdateState>
  /** Quits and installs the downloaded update; no-op when none is ready. */
  restartToInstall(): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}
