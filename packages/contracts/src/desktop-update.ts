/**
 * Auto-update state the desktop shell exposes to the web app over the
 * desktop bridge. This never goes through the server — an update is specific
 * to the machine running the desktop app.
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

/** Desktop auto-update state and controls bridged into the web app. */
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
